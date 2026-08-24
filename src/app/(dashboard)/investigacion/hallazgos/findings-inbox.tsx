"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Trash2,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Flame,
  TrendingUp,
  RotateCcw,
  ArrowDownWideNarrow,
} from "lucide-react";
import { computeFindingScores, pct } from "@/lib/research/scores";

type Finding = {
  id: string;
  title: string;
  url: string | null;
  snippet: string | null;
  summary: string | null;
  author: string | null;
  publishedAt: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  status: string;
  fetchedAt: string;
  source: { id: string; name: string; type: string };
};

/** Formato compacto para números: 1250 → 1.2k, 48200 → 48k */
function compactNum(n: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "—";
  if (n < 1_000) return String(n);
  if (n < 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1_000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

export function FindingsInbox({ initial }: { initial: Finding[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"ALL" | "NEW" | "DISCARDED">("NEW");
  const [q, setQ] = useState("");
  // Orden. Por defecto "recién capturadas": así los hallazgos que acaba de traer
  // el cron salen arriba (aunque su fecha de publicación sea antigua). El usuario
  // cambia a fecha de publicación cuando le interese.
  const [sort, setSort] = useState<"fetched_desc" | "date_desc" | "date_asc">("fetched_desc");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    // Fecha efectiva de un hallazgo: la de publicación si se conoce, si no la
    // de captura (misma que muestra la columna "Fecha").
    const effDate = (f: Finding) => new Date(f.publishedAt ?? f.fetchedAt).getTime();
    const rows = initial
      // Nunca mostramos SENT_TO_ANALYSIS aquí — esos viven arriba como
      // "Ideas interesantes".
      .filter((f) => f.status !== "SENT_TO_ANALYSIS")
      .filter(
        (f) =>
          (filter === "ALL" || f.status === filter) &&
          (!q ||
            f.title.toLowerCase().includes(q.toLowerCase()) ||
            (f.snippet ?? "").toLowerCase().includes(q.toLowerCase()) ||
            (f.summary ?? "").toLowerCase().includes(q.toLowerCase())),
      );
    const sorted = [...rows];
    if (sort === "fetched_desc") {
      sorted.sort((a, b) => new Date(b.fetchedAt).getTime() - new Date(a.fetchedAt).getTime());
    } else {
      sorted.sort((a, b) => (sort === "date_asc" ? effDate(a) - effDate(b) : effDate(b) - effDate(a)));
    }
    return sorted;
  }, [initial, filter, q, sort]);

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);

  function toggle(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  // Descartar / recuperar un hallazgo suelto (sin selección múltiple).
  // DISCARDED → va a la bandeja "Descartados"; NEW → vuelve a "Nuevos".
  const [busyId, setBusyId] = useState<string | null>(null);
  async function setStatus(id: string, next: "NEW" | "DISCARDED") {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/findings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusyId(null);
    if (!res.ok) {
      setError(next === "DISCARDED" ? "Error al descartar" : "Error al recuperar");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function bulkDiscard() {
    if (selectedIds.length === 0) return;
    setError(null);
    const res = await fetch("/api/findings/bulk-discard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    if (!res.ok) {
      setError("Error al descartar");
      return;
    }
    setSelected({});
    startTransition(() => router.refresh());
  }

  async function sendToAnalysis() {
    if (selectedIds.length === 0) return;
    setError(null);
    setMessage(null);
    const res = await fetch("/api/findings/send-to-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Error marcando las investigaciones");
      return;
    }
    setMessage(
      `${selectedIds.length} ${selectedIds.length === 1 ? "hallazgo marcado" : "hallazgos marcados"} como interesantes.`,
    );
    setSelected({});
    startTransition(() => router.refresh());
  }

  // Aprueba como idea (APPROVED) los seleccionados. Enriquece + ideador por
  // cada uno; puede tardar, así que mostramos estado de carga.
  const [promoting, setPromoting] = useState(false);
  async function promoteSelected() {
    if (selectedIds.length === 0) return;
    setError(null);
    setMessage(null);
    setPromoting(true);
    const res = await fetch("/api/findings/bulk-promote-to-idea", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });
    const data = await res.json().catch(() => ({}));
    setPromoting(false);
    if (!res.ok) {
      setError(data.error ?? "Error aprobando como idea");
      return;
    }
    const created = data.created ?? 0;
    const failed = data.failed ?? 0;
    setMessage(
      `${created} ${created === 1 ? "idea aprobada" : "ideas aprobadas"}` +
        (failed > 0 ? ` · ${failed} con error` : "") +
        ". Están en la fase Ideas, listas para producir.",
    );
    setSelected({});
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Barra de acciones — siempre arriba del todo */}
      {selectedIds.length > 0 && (
        <div className="glass-card flex flex-wrap items-center justify-between gap-2 p-3">
          <span className="text-sm font-medium">
            {selectedIds.length} seleccionados
          </span>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={bulkDiscard}
              disabled={pending || promoting}
            >
              <Trash2 className="h-4 w-4" /> Descartar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={sendToAnalysis}
              disabled={pending || promoting}
            >
              <Sparkles className="h-4 w-4" /> Marcar como interesante
            </Button>
            <Button size="sm" onClick={promoteSelected} disabled={pending || promoting}>
              {promoting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              Aprobar como idea
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(["NEW", "DISCARDED", "ALL"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f === "NEW"
              ? "Nuevos"
              : f === "DISCARDED"
                ? "Descartados"
                : "Todos"}
          </Button>
        ))}
        <Input
          placeholder="Buscar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="ml-auto max-w-xs"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowDownWideNarrow className="h-3.5 w-3.5" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as typeof sort)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-xs text-foreground"
            aria-label="Ordenar hallazgos"
          >
            <option value="fetched_desc">Recién capturadas</option>
            <option value="date_desc">Fecha public. ↓ (recientes)</option>
            <option value="date_asc">Fecha public. ↑ (antiguas)</option>
          </select>
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2 text-left"></th>
              <th className="px-3 py-2 text-left">Título & resumen</th>
              <th className="px-3 py-2 text-left">Fuente</th>
              <th className="px-3 py-2 text-right">Alcance</th>
              <th className="px-3 py-2 text-right">Reacciones</th>
              <th className="px-3 py-2 text-right">Scores</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="w-8 px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  Sin hallazgos en esta vista.
                </td>
              </tr>
            )}
            {filtered.map((f) => {
              const totalReactions =
                (f.likes ?? 0) + (f.comments ?? 0) + (f.shares ?? 0);
              const scores = computeFindingScores({
                reach: f.reach,
                likes: f.likes,
                comments: f.comments,
                shares: f.shares,
                publishedAt: f.publishedAt,
              });
              const v = pct(scores.virality);
              const p = pct(scores.potential);
              return (
                <tr
                  key={f.id}
                  className="border-t border-border/40 align-top transition hover:bg-muted/20"
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={!!selected[f.id]}
                      onChange={() => toggle(f.id)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                  </td>
                  <td className="px-3 py-3">
                    <Link
                      href={`/investigacion/hallazgos/${f.id}`}
                      className="font-medium hover:text-foreground"
                    >
                      {f.title}
                    </Link>
                    {f.url && (
                      <a
                        href={f.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 inline-flex text-foreground/70 hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {(f.summary ?? f.snippet) && (
                      <p className="mt-1 line-clamp-2 max-w-xl text-xs text-muted-foreground">
                        {f.summary ?? f.snippet}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    <div className="flex flex-col gap-0.5">
                      <span>{f.source.name}</span>
                      <span className="text-[10px] uppercase tracking-wider opacity-60">
                        {f.source.type}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <span className="inline-flex items-center gap-1 text-xs tabular-nums">
                      <Eye className="h-3 w-3 opacity-60" />
                      {compactNum(f.reach)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-right text-xs">
                    {totalReactions > 0 ? (
                      <div className="flex items-center justify-end gap-2 tabular-nums text-muted-foreground">
                        <span className="inline-flex items-center gap-0.5">
                          <Heart className="h-3 w-3" /> {compactNum(f.likes)}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <MessageCircle className="h-3 w-3" /> {compactNum(f.comments)}
                        </span>
                        <span className="inline-flex items-center gap-0.5">
                          <Share2 className="h-3 w-3" /> {compactNum(f.shares)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground/60">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right text-xs">
                    <div className="flex items-center justify-end gap-2 tabular-nums">
                      {v !== null ? (
                        <span
                          title="Viralidad"
                          className="inline-flex items-center gap-0.5 text-muted-foreground"
                        >
                          <Flame className="h-3 w-3 text-foreground" />
                          <span className="font-semibold text-foreground">{v}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                      <span
                        title="Potencialidad"
                        className="inline-flex items-center gap-0.5 text-muted-foreground"
                      >
                        <TrendingUp className="h-3 w-3 text-foreground" />
                        <span className="font-semibold text-foreground">{p}</span>
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge
                      variant={f.status === "NEW" ? "default" : "outline"}
                      className="text-[10px]"
                    >
                      {f.status === "NEW"
                        ? "Nuevo"
                        : f.status === "DISCARDED"
                          ? "Descartado"
                          : f.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {new Date(f.publishedAt ?? f.fetchedAt).toLocaleDateString("es-ES")}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {f.status === "DISCARDED" ? (
                        <button
                          type="button"
                          onClick={() => setStatus(f.id, "NEW")}
                          disabled={busyId === f.id}
                          title="Recuperar a Nuevos"
                          aria-label="Recuperar hallazgo"
                          className="inline-flex text-muted-foreground/60 transition hover:text-foreground disabled:opacity-40"
                        >
                          {busyId === f.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setStatus(f.id, "DISCARDED")}
                          disabled={busyId === f.id}
                          title="Descartar"
                          aria-label="Descartar hallazgo"
                          className="inline-flex text-muted-foreground/60 transition hover:text-destructive disabled:opacity-40"
                        >
                          {busyId === f.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                      <Link
                        href={`/investigacion/hallazgos/${f.id}`}
                        className="inline-flex text-muted-foreground/60 hover:text-foreground"
                        aria-label="Abrir ficha"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
