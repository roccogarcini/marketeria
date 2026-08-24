import { prisma } from "@/lib/prisma";
import { IdeasGrid } from "./ideas-grid";
import { PhaseHeader } from "@/components/layout/phase-header";

export const dynamic = "force-dynamic";

export default async function IdeasPage() {
  const [ideas, channels] = await Promise.all([
    prisma.idea.findMany({
      where: { status: { in: ["APPROVED", "REJECTED", "ARCHIVED"] } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        _count: { select: { comments: true, contents: true } },
        contents: { select: { _count: { select: { assets: true } } } },
      },
    }),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ]);

  const approvedCount = ideas.filter((i) => i.status === "APPROVED").length;
  const otherCount = ideas.length - approvedCount;

  return (
    <div className="flex flex-col gap-6">
      <PhaseHeader
        phase={2}
        title="Ideas"
        subtitle="Tus ideas aprobadas. Entra en cada una para editarla o producir creaciones."
        stats={[
          { label: "aprobadas", value: approvedCount, accent: true },
          ...(otherCount > 0
            ? [{ label: "archivadas / rechazadas", value: otherCount }]
            : []),
        ]}
      />
      <IdeasGrid
        initial={ideas.map((i) => ({
          id: i.id,
          title: i.title,
          rationale: i.rationale,
          status: i.status,
          referenceUrl: i.referenceUrl,
          viralityScore: i.viralityScore,
          potentialScore: i.potentialScore,
          idealFormat: i.idealFormat,
          // Sumamos los assets publicados a través de los contents de la idea.
          // Una idea → 1+ Content (texto madre) → N Assets (adaptaciones por
          // canal). La "pieza" del badge se refiere a estas adaptaciones.
          contents: i.contents.reduce((n, c) => n + c._count.assets, 0),
          updatedAt: i.updatedAt.toISOString(),
        }))}
        channels={channels}
      />
    </div>
  );
}
