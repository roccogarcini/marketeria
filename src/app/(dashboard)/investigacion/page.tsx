import { prisma } from "@/lib/prisma";
import { FindingsInbox } from "./hallazgos/findings-inbox";
import { InterestingFindings } from "./interesting-findings";
import { PhaseHeader } from "@/components/layout/phase-header";
import { ResearchActions } from "@/components/research/research-actions";

export const dynamic = "force-dynamic";

export default async function ResearchHome() {
  const [sources, nuevos, enviados, interesting, findings, allSources] =
    await Promise.all([
      prisma.source.count(),
    prisma.finding.count({ where: { status: "NEW" } }),
    prisma.finding.count({ where: { status: "SENT_TO_ANALYSIS" } }),
    // Investigaciones marcadas como interesantes (suben al grupo de arriba).
    prisma.finding.findMany({
      where: { status: "SENT_TO_ANALYSIS" },
      orderBy: [{ publishedAt: "desc" }, { fetchedAt: "desc" }],
      take: 12,
      include: { source: { select: { name: true, type: true, url: true } } },
    }),
    prisma.finding.findMany({
      orderBy: { fetchedAt: "desc" },
      take: 200,
      include: { source: { select: { id: true, name: true, type: true } } },
    }),
    // Sources activas para los lanzadores de búsqueda.
    // Incluimos platform + configJson para que el ApifyLauncher pueda
    // preconfigurar query/maxItems/filters/actorId al elegir una fuente
    // existente (en vez de obligar al usuario a teclearlos otra vez).
    prisma.source.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        type: true,
        isActive: true,
        platform: true,
        configJson: true,
      },
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PhaseHeader
        phase={1}
        title="Investigación"
        subtitle="El sistema investiga, cribe y analiza. Aprueba las ideas que quieras llevar a producción."
        stats={[
          { label: "interesantes", value: enviados, accent: true },
          { label: "hallazgos nuevos", value: nuevos },
          { label: "fuentes", value: sources },
        ]}
        actions={<ResearchActions sources={allSources} />}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Interesantes
        </h2>
        <InterestingFindings
          initial={interesting.map((f) => ({
            id: f.id,
            title: f.title,
            url: f.url,
            summary: f.summary,
            snippet: f.snippet,
            reach: f.reach,
            likes: f.likes,
            comments: f.comments,
            shares: f.shares,
            publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null,
            source: f.source,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Bandeja de hallazgos
        </h2>
        <FindingsInbox
          initial={findings.map((f) => ({
            id: f.id,
            title: f.title,
            url: f.url,
            snippet: f.snippet,
            summary: f.summary,
            author: f.author,
            publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null,
            reach: f.reach,
            likes: f.likes,
            comments: f.comments,
            shares: f.shares,
            status: f.status,
            fetchedAt: f.fetchedAt.toISOString(),
            source: f.source,
          }))}
        />
      </section>
    </div>
  );
}
