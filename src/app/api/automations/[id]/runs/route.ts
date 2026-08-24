import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// GET /api/automations/[id]/runs — historial de ejecuciones (últimas N) para
// comprobar a qué hora dispara el cron. Política: admin.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const runs = await prisma.automationRun.findMany({
    where: { automationId: id },
    orderBy: { startedAt: "desc" },
    take: 30,
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      logsText: true,
    },
  });

  return NextResponse.json({
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      // Log recortado: para depurar la ejecución sin arrastrar textos enormes.
      logs: r.logsText ? r.logsText.slice(0, 2000) : null,
    })),
  });
}
