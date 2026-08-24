import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { enrichFinding } from "@/lib/research/enrich";
import { materialLevel } from "@/lib/research/material";

// Política: editor.
// Descarga el contenido completo de la URL del hallazgo y lo guarda en
// fullContent. Devuelve el resultado y el nivel de material resultante.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const result = await enrichFinding(id);

  const finding = await prisma.finding.findUnique({
    where: { id },
    select: { fullContent: true, summary: true, snippet: true },
  });
  const level = finding ? materialLevel(finding) : null;

  if (result.status === "failed") {
    return NextResponse.json({ ...result, level }, { status: 422 });
  }
  return NextResponse.json({ ...result, level });
}
