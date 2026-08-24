import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PhaseHeader } from "@/components/layout/phase-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Settings2,
  LinkIcon,
  Share2,
  Layers,
  ExternalLink,
  FileText,
} from "lucide-react";

export const dynamic = "force-dynamic";

function simplified(status: string): "Borrador" | "Final" {
  return status === "SCHEDULED" || status === "PUBLISHED" ? "Final" : "Borrador";
}

export default async function AssetsHome() {
  // Una idea con al menos 1 asset producido; agrupamos sus piezas.
  const ideas = await prisma.idea.findMany({
    where: {
      status: "APPROVED",
      contents: { some: { assets: { some: {} } } },
    },
    orderBy: { updatedAt: "desc" },
    include: {
      contents: {
        include: {
          assets: {
            include: { channel: true },
            orderBy: { updatedAt: "desc" },
          },
        },
      },
    },
  });

  let totalAssets = 0;
  let finals = 0;
  let drafts = 0;
  const blocks = ideas
    .map((idea) => {
      const assets = idea.contents.flatMap((c) =>
        c.assets.map((a) => ({
          id: a.id,
          channelId: a.channelId,
          channelName: a.channel.name,
          channelType: a.channel.type,
          status: a.status,
          body: a.body,
        })),
      );
      totalAssets += assets.length;
      for (const a of assets) {
        if (simplified(a.status) === "Final") finals++;
        else drafts++;
      }
      return {
        id: idea.id,
        title: idea.title,
        referenceUrl: idea.referenceUrl,
        idealFormat: idea.idealFormat,
        contentId: idea.contents[0]?.id ?? null,
        assets,
      };
    })
    .filter((b) => b.assets.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <PhaseHeader
        phase={3}
        title="Creaciones"
        subtitle="Tus ideas desarrolladas para cada canal. Entra en cualquier pieza para ver, editar o copiar."
        stats={[
          { label: "piezas", value: totalAssets, accent: true },
          { label: "finales", value: finals },
          { label: "borradores", value: drafts },
          { label: "ideas con piezas", value: blocks.length },
        ]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/modulos/canales">
              <Settings2 className="h-4 w-4" /> Gestionar canales
            </Link>
          </Button>
        }
      />

      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
          Aún no has producido piezas. Ve a una{" "}
          <Link href="/ideas" className="font-medium text-foreground hover:underline">
            idea aprobada
          </Link>{" "}
          y produce sus creaciones.
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {blocks.map((b) => (
            <section
              key={b.id}
              className="flex flex-col gap-3 rounded-2xl border border-border/40 bg-background/30 p-5"
            >
              {/* Idea header */}
              <header className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/ideas/${b.id}`}
                    className="text-base font-semibold hover:text-foreground"
                  >
                    {b.title}
                  </Link>
                  <span className="inline-flex items-center gap-3">
                    {b.contentId && (
                      <Link
                        href={`/produccion/${b.contentId}`}
                        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                      >
                        Contenido base <FileText className="h-3 w-3" />
                      </Link>
                    )}
                    <Link
                      href={`/ideas/${b.id}`}
                      className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
                    >
                      Abrir idea <ExternalLink className="h-3 w-3" />
                    </Link>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {b.idealFormat && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 text-foreground">
                      <Layers className="h-3 w-3" /> {b.idealFormat}
                    </span>
                  )}
                  {b.referenceUrl && (
                    <a
                      href={b.referenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-sm items-center gap-1 truncate hover:text-foreground"
                    >
                      <LinkIcon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{b.referenceUrl}</span>
                    </a>
                  )}
                </div>
              </header>

              {/* Piezas */}
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {b.assets.map((a) => {
                  const simple = simplified(a.status);
                  return (
                    <Link
                      key={a.id}
                      href={`/soportes/${a.id}`}
                      className="group flex flex-col gap-1.5 rounded-xl border border-border/50 bg-background/40 p-3 transition hover:border-primary/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-foreground">
                            <Share2 className="h-3 w-3" />
                          </div>
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate text-sm font-medium group-hover:text-foreground">
                              {a.channelName}
                            </span>
                            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              {a.channelType}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant={simple === "Final" ? "default" : "outline"}
                          className="shrink-0 text-[10px]"
                        >
                          {simple}
                        </Badge>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {a.channelType === "CAROUSEL"
                          ? "Carrusel (slides HTML) — abre la pieza para previsualizarlo."
                          : `${a.body.replace(/^#+\s*/gm, "").slice(0, 160)}…`}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
