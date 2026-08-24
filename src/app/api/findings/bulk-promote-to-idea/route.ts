import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { promoteFindingToIdea } from "@/lib/pipeline/promote";

/**
 * POST /api/findings/bulk-promote-to-idea
 *   { ids: string[] }
 *
 * Aprueba como idea varios hallazgos a la vez. Cada uno se procesa de forma
 * independiente (enriquece + ideador); los que fallen se reportan sin abortar
 * el resto. Política: editor.
 */
export const maxDuration = 300; // varios hallazgos × ideador puede tardar

const schema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(50),
});

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido: { ids }" }, { status: 400 });
  }

  const results: Array<{ findingId: string; ideaId?: string; error?: string }> = [];
  for (const id of parsed.data.ids) {
    try {
      const r = await promoteFindingToIdea(guard.user.id, id);
      if (r.ok) results.push({ findingId: id, ideaId: r.idea.id });
      else results.push({ findingId: id, error: r.error });
    } catch (err) {
      results.push({
        findingId: id,
        error: err instanceof Error ? err.message.slice(0, 200) : "Error inesperado",
      });
    }
  }

  const created = results.filter((r) => r.ideaId).length;
  const failed = results.length - created;
  return NextResponse.json({ created, failed, results }, { status: 201 });
}
