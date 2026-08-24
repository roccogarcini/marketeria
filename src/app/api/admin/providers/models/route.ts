import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { listProviderModels } from "@/lib/ai/api";
import type { ProviderType } from "@/lib/ai/providers";

/**
 * POST /api/admin/providers/models — lista los modelos disponibles de un
 * proveedor LLM preguntando a su API. Dos modos:
 *   { providerId }                      → usa la clave cifrada guardada
 *   { providerType, apiKey, baseUrl? }  → alta: la clave aún no está guardada
 * La clave nunca se devuelve; solo la lista de ids. Política: admin.
 */
const schema = z
  .object({
    providerId: z.string().uuid().optional(),
    providerType: z
      .enum(["OPENAI", "ANTHROPIC", "OPENROUTER", "CUSTOM", "ZAI", "DEEPSEEK", "GEMINI"])
      .optional(),
    apiKey: z.string().min(1).max(500).optional(),
    baseUrl: z.string().url().max(1000).optional().nullable(),
  })
  .refine((d) => d.providerId || (d.providerType && d.apiKey), {
    message: "providerId o providerType+apiKey requeridos",
  });

export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let type: ProviderType;
  let apiKey: string;
  let baseUrl: string | null;

  if (parsed.data.providerId) {
    const provider = await prisma.lLMProvider.findFirst({
      where: { id: parsed.data.providerId, userId: guard.user.id },
    });
    if (!provider) {
      return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
    }
    type = provider.providerType as ProviderType;
    try {
      apiKey = decrypt(provider.encryptedApiKey);
    } catch {
      return NextResponse.json({ error: "No se pudo descifrar la clave." });
    }
    baseUrl = provider.baseUrl;
  } else {
    type = parsed.data.providerType as ProviderType;
    apiKey = parsed.data.apiKey as string;
    baseUrl = parsed.data.baseUrl ?? null;
  }

  try {
    const models = await listProviderModels(type, apiKey, baseUrl);
    return NextResponse.json({ models });
  } catch (err) {
    // Mensaje de la API del proveedor (clave inválida, endpoint sin /models…),
    // accionable para el admin; truncado como en el endpoint de test.
    return NextResponse.json({
      error: err instanceof Error ? err.message.slice(0, 200) : "Error listando modelos",
    });
  }
}
