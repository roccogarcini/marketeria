"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Undo2,
  ExternalLink,
  CheckCircle2,
  Flame,
  TrendingUp,
  Rss,
  Globe,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { computeFindingScores, pct } from "@/lib/research/scores";

export type InterestingFinding = {
  id: string;
  title: string;
  url: string | null;
  summary: string | null;
  snippet: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  publishedAt: string | null;
  source: { name: string; type: string; url: string | null };
};

function iconForSourceType(type: string): LucideIcon {
  const t = type.toUpperCase();
  if (t === "RSS") return Rss;
  if (t === "URL") return Globe;
  if (t === "MANUAL") return PenLine;
  return Globe;
}

function compactNum(n: number | null): string {
  if (n === null || n === undefined || n === 0) return "—";
  if (n < 1_000) return String(n);
  if (n < 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1_000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

export function InterestingFindings({ initial }: { initial: InterestingFinding[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function demote(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/findings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "NEW" }),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al mover la investigación");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function promote(id: string) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/findings/${id}/promote-to-idea`, {
      method: "POST",
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al aprobar como idea");
      return;
    }
    startTransition(() => router.refresh());
  }

  if (initial.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/50 p-4 text-sm text-muted-foreground">
        Todavía no has marcado nada como interesante. Marca hallazgos como
        interesantes (desde la bandeja de abajo) para que aparezcan aquí.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {initial.map((f) => {
          const SourceIcon = iconForSourceType(f.source.type);
          return (
            <div
              key={f.id}
              className="group flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-4 transition hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex-1 text-sm font-semibold leading-snug">
                  <Link
                    href={`/investigacion/hallazgos/${f.id}`}
                    className="hover:text-foreground"
                  >
                    {f.title}
                  </Link>
                  {f.url && (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 inline-flex align-baseline text-foreground/70 hover:text-foreground"
                      title="Ver fuente original"
                      aria-label="Ver fuente original"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="inline h-3.5 w-3.5" />
                    </a>
                  )}
                </p>
                <SourceIcon className="h-4 w-4 shrink-0 text-foreground/80" />
              </div>

              {(f.summary ?? f.snippet) && (
                <p className="line-clamp-3 text-xs text-muted-foreground">
                  {f.summary ?? f.snippet}
                </p>
              )}

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {compactNum(f.reach)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Heart className="h-3 w-3" /> {compactNum(f.likes)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3 w-3" /> {compactNum(f.comments)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Share2 className="h-3 w-3" /> {compactNum(f.shares)}
                </span>
              </div>

              {/* Viralidad + potencialidad calculadas sin IA */}
              {(() => {
                const scores = computeFindingScores(f);
                const v = pct(scores.virality);
                const p = pct(scores.potential);
                return (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {v !== null && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-muted-foreground">
                        <Flame className="h-3 w-3 text-foreground" />
                        <span className="font-semibold text-foreground">{v}</span>
                        viral
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-muted-foreground">
                      <TrendingUp className="h-3 w-3 text-foreground" />
                      <span className="font-semibold text-foreground">{p}</span>
                      potencial
                    </span>
                  </div>
                );
              })()}

              <span className="line-clamp-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                {f.source.url ? (
                  <a
                    href={f.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                    title="Abrir fuente"
                  >
                    {f.source.name} · {f.source.type}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                ) : (
                  <>
                    {f.source.name} · {f.source.type}
                  </>
                )}
              </span>

              {/* Acciones ancladas al fondo de la card con mt-auto */}
              <div className="mt-auto flex flex-col gap-2 pt-2">
                <Button
                  size="sm"
                  onClick={() => promote(f.id)}
                  disabled={busyId === f.id || pending}
                  className="w-full gap-1.5"
                >
                  {busyId === f.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Aprobar como idea
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    asChild
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                  >
                    <Link href={`/investigacion/hallazgos/${f.id}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                      Abrir ficha
                    </Link>
                  </Button>
                  {f.url && (
                    <Button
                      asChild
                      size="icon"
                      variant="ghost"
                      title="Ver fuente original"
                      aria-label="Ver fuente original"
                    >
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Globe className="h-4 w-4" />
                      </a>
                    </Button>
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => demote(f.id)}
                    disabled={busyId === f.id || pending}
                    aria-label="Volver a la bandeja"
                    title="Volver a la bandeja"
                  >
                    <Undo2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
