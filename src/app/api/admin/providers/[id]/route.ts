import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  deleteProvider,
  setDefaultResearchProvider,
  clearDefaultResearchProvider,
} from "@/lib/ai/providers";

// Todos los campos opcionales: el mismo endpoint edita el modelo por defecto
// o marca/desmarca el proveedor como predeterminado de la Investigación IA.
const patchSchema = z.object({
  defaultModel: z.string().max(200).nullable().optional(),
  isDefaultResearch: z.boolean().optional(),
  // Permite cambiar el endpoint/plan (p. ej. z.ai estándar ↔ coding) sin
  // recrear el proveedor. null/"" → vuelve al baseURL por defecto del tipo.
  baseUrl: z.string().max(500).nullable().optional(),
});

// Actualiza el proveedor sin recrearlo (la clave cifrada no se toca).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Marca/desmarca predeterminado (solo un LLM puede serlo por usuario).
  if (parsed.data.isDefaultResearch !== undefined) {
    if (parsed.data.isDefaultResearch) {
      const ok = await setDefaultResearchProvider(guard.user.id, id);
      if (!ok) {
        return NextResponse.json(
          { error: "Solo un proveedor LLM propio puede marcarse por defecto." },
          { status: 400 },
        );
      }
    } else {
      await clearDefaultResearchProvider(guard.user.id, id);
    }
  }

  // Cambia el modelo por defecto y/o el baseUrl (plan) si vienen en el payload.
  const data: { defaultModel?: string | null; baseUrl?: string | null } = {};
  if (parsed.data.defaultModel !== undefined) {
    data.defaultModel = parsed.data.defaultModel?.trim() || null;
  }
  if (parsed.data.baseUrl !== undefined) {
    data.baseUrl = parsed.data.baseUrl?.trim() || null;
  }
  if (Object.keys(data).length > 0) {
    const updated = await prisma.lLMProvider.updateMany({
      where: { id, userId: guard.user.id },
      data,
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }
  }

  return NextResponse.json({ ok: true });
}

// Política: admin
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await deleteProvider(guard.user.id, id);
  return NextResponse.json({ ok: true });
}
