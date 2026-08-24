import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  generateApiKey,
  hashApiKey,
  apiKeyPrefix,
} from "@/lib/api-keys/auth";

// Política: admin.
// GET  → lista las claves (nunca la clave completa: solo prefijo).
// POST → crea una clave y devuelve la clave completa UNA ÚNICA VEZ.

export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      isActive: true,
      lastUsedAt: true,
      createdAt: true,
      createdBy: { select: { name: true } },
    },
  });
  return NextResponse.json({ keys });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scope: z.enum(["read", "read_write"]),
});

export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido: { name, scope }" }, { status: 400 });
  }
  const key = generateApiKey();
  const row = await prisma.apiKey.create({
    data: {
      name: parsed.data.name,
      scope: parsed.data.scope,
      prefix: apiKeyPrefix(key),
      hashedKey: hashApiKey(key),
      createdById: guard.user.id,
    },
    select: { id: true, name: true, prefix: true, scope: true, createdAt: true },
  });
  // La clave completa SOLO viaja en esta respuesta; no se puede recuperar después.
  return NextResponse.json({ key, apiKey: row }, { status: 201 });
}
