import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { enrichFindingsBestEffort } from "@/lib/research/enrich";

// Política: editor
// Crea un AnalysisRun PENDING con los findings seleccionados y marca los findings como SENT_TO_ANALYSIS.
const schema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(500) });

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const findings = await prisma.finding.findMany({
    where: { id: { in: parsed.data.ids } },
    select: { id: true },
  });
  if (findings.length === 0) return NextResponse.json({ error: "No findings" }, { status: 404 });

  const run = await prisma.analysisRun.create({
    data: {
      status: "PENDING",
      findingIdsJson: JSON.stringify(findings.map((f) => f.id)),
    },
  });
  await prisma.finding.updateMany({
    where: { id: { in: findings.map((f) => f.id) } },
    data: { status: "SENT_TO_ANALYSIS" },
  });

  // Enriquecimiento best-effort: al marcar como interesante empieza a importar
  // el contenido completo (será la materia prima de ideación/producción).
  // No bloquea la respuesta si alguna URL falla.
  await enrichFindingsBestEffort(findings.map((f) => f.id));

  return NextResponse.json({ run }, { status: 201 });
}
