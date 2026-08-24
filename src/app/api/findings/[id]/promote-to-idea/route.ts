import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { promoteFindingToIdea } from "@/lib/pipeline/promote";

/**
 * POST /api/findings/[id]/promote-to-idea
 *
 * Convierte una investigación interesante en una idea APROBADA directamente
 * (enriquece + ideador + traza AnalysisRun→Insight→Idea). Lógica en
 * src/lib/pipeline/promote.ts, compartida con el endpoint masivo.
 *
 * Política: editor.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const result = await promoteFindingToIdea(guard.user.id, id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ idea: result.idea }, { status: 201 });
}
