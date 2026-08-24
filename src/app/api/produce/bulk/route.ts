import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { produceIdea } from "@/lib/pipeline/produce";

/**
 * POST /api/produce/bulk
 *   { ideaIds: string[], channelIds?: string[] }
 *
 * Produce varias ideas a la vez para los mismos canales. Cada idea se procesa
 * de forma independiente (reutiliza produceIdea); los fallos se reportan sin
 * abortar el resto. Política: editor.
 */
export const maxDuration = 300;

const schema = z.object({
  ideaIds: z.array(z.string().min(1).max(128)).min(1).max(30),
  channelIds: z.array(z.string().min(1).max(128)).max(20).optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido: { ideaIds, channelIds? }" },
      { status: 400 },
    );
  }

  const results: Array<{
    ideaId: string;
    ok: boolean;
    assets?: number;
    errors?: number;
    error?: string;
  }> = [];

  for (const ideaId of parsed.data.ideaIds) {
    try {
      const r = await produceIdea(guard.user.id, {
        ideaId,
        channelIds: parsed.data.channelIds,
      });
      if (!r.ok) {
        results.push({ ideaId, ok: false, error: r.error });
        continue;
      }
      const assets = r.results.filter((x) => x.asset).length;
      const errors = r.results.filter((x) => x.error).length;
      results.push({ ideaId, ok: true, assets, errors });
    } catch (err) {
      results.push({
        ideaId,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : "Error inesperado",
      });
    }
  }

  const producedIdeas = results.filter((r) => r.ok).length;
  const totalAssets = results.reduce((n, r) => n + (r.assets ?? 0), 0);
  const failedIdeas = results.filter((r) => !r.ok).length;
  return NextResponse.json(
    { producedIdeas, totalAssets, failedIdeas, results },
    { status: 201 },
  );
}
