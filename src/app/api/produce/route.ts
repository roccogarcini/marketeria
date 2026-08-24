import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { produceIdea } from "@/lib/pipeline/produce";

/**
 * Endpoint "atajo" de producción (UI).
 *
 *   POST /api/produce
 *     { ideaId, channelId?, channelIds? }
 *
 * La lógica vive en src/lib/pipeline/produce.ts (compartida con la API v1 y
 * el servidor MCP):
 *   1. Valida que la idea esté APPROVED.
 *   2. Busca/crea un Content APPROVED interno de esa idea (auto-aprobado).
 *   3. Para cada canal (0..N): genera la creación (o devuelve la existente).
 *
 * Respuesta:
 *   { content, contentGenerated, results: [{ channelId, asset?, existing?, error? }] }
 *
 * Política: editor.
 */
const bodySchema = z
  .object({
    ideaId: z.string().min(1).max(128),
    channelId: z.string().min(1).max(128).optional(),
    channelIds: z.array(z.string().min(1).max(128)).max(20).optional(),
  })
  .refine((v) => !(v.channelId && v.channelIds && v.channelIds.length > 0), {
    message: "Usa channelId o channelIds, no ambos",
  });

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  // Normalizamos: trabajamos con un array (vacío si solo content).
  const channelIds: string[] = parsed.data.channelIds
    ? parsed.data.channelIds
    : parsed.data.channelId
      ? [parsed.data.channelId]
      : [];

  const result = await produceIdea(guard.user.id, {
    ideaId: parsed.data.ideaId,
    channelIds,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { content, contentGenerated, results } = result;
  return NextResponse.json(
    { content, contentGenerated, results },
    { status: channelIds.length === 0 ? 200 : 201 },
  );
}
