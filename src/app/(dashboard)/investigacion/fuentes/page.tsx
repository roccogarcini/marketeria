import { prisma } from "@/lib/prisma";
import { SourcesManager } from "./sources-manager";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const sources = await prisma.source.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { findings: true } } },
  });
  return (
    <SourcesManager
      initial={sources.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        url: s.url,
        platform: s.platform,
        isActive: s.isActive,
        lastFetchedAt: s.lastFetchedAt?.toISOString() ?? null,
        findingsCount: s._count.findings,
      }))}
    />
  );
}
