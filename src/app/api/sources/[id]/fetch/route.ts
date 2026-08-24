import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { runSourceFetch } from "@/lib/research/fetcher";

// Política: editor
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  try {
    const outcome = await runSourceFetch(id, { userId: guard.user.id });
    return NextResponse.json(outcome);
  } catch (err) {
    console.error(`[sources/fetch] ${id}:`, err);
    return NextResponse.json(
      { error: "No se pudo ejecutar la búsqueda de la fuente" },
      { status: 500 },
    );
  }
}
