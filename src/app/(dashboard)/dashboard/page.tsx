import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { Search, Lightbulb, Share2 } from "lucide-react";
import { SpiderDiagram } from "@/components/dashboard/spider-diagram";

export const dynamic = "force-dynamic";

/**
 * Datos del dashboard alineados al pipeline de 3 fases:
 *   Investigación (findings) → Ideas (aprobadas, cuerpo) → Creaciones (piezas/assets).
 * Los assets se muestran atados a su idea de origen; la entidad Content no
 * se expone en la UI.
 */
async function getDashboardData() {
  const [
    findingsCount,
    suggestedCount,
    sourcesCount,
    approvedIdeasCount,
    assetsCount,
    allApprovedIdeas,
    ideasWithAssets,
    recentFindings,
    analysisRuns,
  ] = await Promise.all([
    prisma.finding.count(),
    prisma.idea.count({ where: { status: { in: ["DRAFT", "PROPOSED"] } } }),
    prisma.source.count(),
    prisma.idea.count({ where: { status: "APPROVED" } }),
    prisma.asset.count(),
    // TODAS las ideas aprobadas con el linaje a su AnalysisRun.
    prisma.idea.findMany({
      where: { status: "APPROVED" },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        angle: true,
        rationale: true,
        insight: {
          select: {
            analysisRun: { select: { findingIdsJson: true } },
          },
        },
      },
    }),
    // Ideas aprobadas CON piezas producidas. Usadas para dibujar hilos
    // idea→asset y para listar todos los soportes del tablero.
    prisma.idea.findMany({
      where: {
        status: "APPROVED",
        contents: { some: { assets: { some: {} } } },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        contents: {
          include: {
            assets: {
              include: { channel: { select: { name: true, type: true } } },
            },
          },
        },
      },
    }),
    // TODOS los hallazgos disponibles (no solo los 8 más recientes).
    // Ordenados por estado (SENT_TO_ANALYSIS > NEW > DISCARDED) + fecha.
    prisma.finding.findMany({
      orderBy: [{ status: "desc" }, { fetchedAt: "desc" }],
      include: { source: { select: { name: true, type: true } } },
    }),
    // Linaje Finding → AnalysisRun → Insight → Idea. Lo usamos después para
    // resolver a qué idea aprobada contribuyó cada finding.
    prisma.analysisRun.findMany({
      select: {
        findingIdsJson: true,
        insights: {
          select: {
            ideas: {
              where: { status: "APPROVED" },
              select: { id: true },
              orderBy: { updatedAt: "desc" },
              take: 1,
            },
          },
        },
      },
    }),
  ]);

  return {
    totals: {
      findings: findingsCount,
      suggested: suggestedCount,
      sources: sourcesCount,
      approvedIdeas: approvedIdeasCount,
      assets: assetsCount,
    },
    ...(() => {
      // Modelo many-to-one: UNA idea aprobada puede nacer de VARIOS findings
      // (los que el AnalysisRun analizó juntos). Cada finding que contribuyó
      // a una idea aprobada se conecta con ella mediante un hilo. Ideas sin
      // findings visibles quedan sin hilos entrantes.
      const visibleFindingIds = new Set(recentFindings.map((f) => f.id));
      const findingToIdea = new Map<string, string>();
      const ideaToOriginFinding = new Map<string, string>();

      for (const idea of allApprovedIdeas) {
        if (!idea.insight) continue;
        let fids: string[] = [];
        try {
          const parsed = JSON.parse(idea.insight.analysisRun.findingIdsJson);
          if (Array.isArray(parsed))
            fids = parsed.filter((x): x is string => typeof x === "string");
        } catch {
          continue;
        }
        for (const fid of fids) {
          if (visibleFindingIds.has(fid) && !findingToIdea.has(fid)) {
            findingToIdea.set(fid, idea.id);
            if (!ideaToOriginFinding.has(idea.id)) {
              ideaToOriginFinding.set(idea.id, fid);
            }
          }
        }
      }

      return {
        findings: recentFindings.map((f) => ({
          id: f.id,
          title: f.title,
          sourceName: f.source.name,
          sourceType: f.source.type,
          status: f.status,
          snippet: f.summary ?? f.snippet ?? null,
          publishedAt: f.publishedAt ? f.publishedAt.toISOString() : null,
          url: f.url,
          reach: f.reach,
          ideaId: findingToIdea.get(f.id) ?? null,
        })),
        ideas: allApprovedIdeas.map((i) => ({
          id: i.id,
          title: i.title,
          angle: i.angle,
          description: i.rationale,
          contentsCount: 0,
          originFindingId: ideaToOriginFinding.get(i.id) ?? null,
        })),
      };
    })(),
    groups: ideasWithAssets
      .map((i) => ({
        id: i.id,
        title: i.title,
        ideaId: i.id,
        assets: i.contents.flatMap((c) =>
          c.assets.map((a) => ({
            id: a.id,
            channelName: a.channel.name,
            channelType: a.channel.type,
            status: a.status,
            contentTitle: c.title,
          })),
        ),
      }))
      .filter((g) => g.assets.length > 0),
  };
}

export default async function DashboardHome() {
  const session = await auth();
  const data = await getDashboardData();

  // Aviso proactivo: sin proveedor LLM activo, ninguna generación IA funciona.
  const llmProviders = await prisma.lLMProvider.count({
    where: {
      isActive: true,
      providerType: {
        in: ["OPENAI", "ANTHROPIC", "OPENROUTER", "CUSTOM", "ZAI", "DEEPSEEK", "GEMINI"],
      },
    },
  });
  const noProvider = llmProviders === 0;

  const kpis = [
    {
      title: "Investigación",
      count: data.totals.findings,
      href: "/investigacion",
      icon: Search,
      dot: "bg-info",
      foot: `${data.totals.sources} fuentes · ${data.totals.suggested} por revisar`,
    },
    {
      title: "Ideas",
      count: data.totals.approvedIdeas,
      href: "/ideas",
      icon: Lightbulb,
      dot: "bg-primary",
      foot: "aprobadas",
    },
    {
      title: "Creaciones",
      count: data.totals.assets,
      href: "/soportes",
      icon: Share2,
      dot: "bg-ok",
      foot: "piezas",
    },
    {
      title: "Por revisar",
      count: data.totals.suggested,
      href: "/ideas",
      icon: Lightbulb,
      dot: "bg-warn",
      foot: "ideas sin aprobar",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="eyebrow">
          Pipeline · Hola, {session?.user?.name?.split(" ")[0] ?? "equipo"}
        </p>
        <h1 className="display-lg">
          Convierte <span className="wavy">señales sueltas</span> en publicaciones
          con criterio.
        </h1>
        <p className="max-w-[64ch] text-[15px] text-muted-foreground">
          Tres pasos, un solo flujo: la IA investiga fuentes, tú apruebas las ideas
          que valen, y Marketería produce las piezas adaptadas a cada canal.
        </p>
      </header>

      {noProvider && (
        <div
          role="alert"
          className="flex flex-col gap-1 rounded-xl border border-warn/40 bg-warn/[0.08] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        >
          <span className="text-foreground">
            <span className="font-medium">No hay ningún proveedor de IA configurado.</span>{" "}
            <span className="text-muted-foreground">
              Las generaciones (producir, chat, análisis) no funcionarán hasta que añadas uno.
            </span>
          </span>
          <Link
            href="/admin/proveedores"
            className="shrink-0 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-accent-deep"
          >
            Añadir proveedor
          </Link>
        </div>
      )}

      {/* KPIs operativos */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <Link
            key={k.title}
            href={k.href}
            className="kpi-card group transition-colors hover:border-accent-deep/50"
          >
            <div className="kpi-label">
              <span className={`h-[7px] w-[7px] rounded-full ${k.dot}`} />
              {k.title}
            </div>
            <div className="kpi-num num">{k.count}</div>
            <div className="mt-2 text-xs text-muted-foreground">{k.foot}</div>
          </Link>
        ))}
      </div>

      {/* Grafo del pipeline — widget secundario */}
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-5 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] rounded-full bg-info" /> Investigación{" "}
              <b className="font-mono text-foreground">{data.totals.findings}</b>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] rounded-full bg-primary" /> Ideas{" "}
              <b className="font-mono text-foreground">{data.totals.approvedIdeas}</b>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-[7px] w-[7px] rounded-full bg-ok" /> Creaciones{" "}
              <b className="font-mono text-foreground">{data.totals.assets}</b>
            </span>
          </div>
          <span className="eyebrow flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-[10px]">
            <span className="h-[6px] w-[6px] rounded-full bg-primary" /> Flujo en vivo
          </span>
        </div>
        <SpiderDiagram
          findings={data.findings}
          ideas={data.ideas}
          groups={data.groups}
          totals={{
            sources: data.totals.sources,
            findings: data.totals.findings,
            ideas: data.totals.approvedIdeas,
            assets: data.totals.assets,
          }}
        />
      </section>
    </div>
  );
}
