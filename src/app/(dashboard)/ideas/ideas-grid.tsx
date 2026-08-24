"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Loader2,
  Flame,
  TrendingUp,
  Layers,
  LinkIcon,
  FileText,
  Archive,
  LayoutGrid,
  List as ListIcon,
  Sparkles,
} from "lucide-react";

type Idea = {
  id: string;
  title: string;
  rationale: string | null;
  status: string;
  referenceUrl: string | null;
  viralityScore: number | null;
  potentialScore: number | null;
  idealFormat: string | null;
  contents: number;
  updatedAt: string;
};

type ChannelOption = { id: string; name: string; type: string };

export function IdeasGrid({
  initial,
  channels,
}: {
  initial: Idea[];
  channels: ChannelOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [form, setForm] = useState({
    title: "",
    rationale: "",
    referenceUrl: "",
    idealFormat: "",
  });
  const [error, setError] = useState<string | null>(null);

  const approved = useMemo(() => initial.filter((i) => i.status === "APPROVED"), [initial]);
  const archived = useMemo(
    () => initial.filter((i) => i.status !== "APPROVED"),
    [initial],
  );

  // ── Selección múltiple (modo lista) + producción en masa ────────────────
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const [picking, setPicking] = useState(false);
  const [pickedChannels, setPickedChannels] = useState<Record<string, boolean>>({});
  const [producing, setProducing] = useState(false);
  const [prodMsg, setProdMsg] = useState<string | null>(null);

  function toggleIdea(id: string) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }
  function toggleAll() {
    if (selectedIds.length === approved.length) setSelected({});
    else setSelected(Object.fromEntries(approved.map((i) => [i.id, true])));
  }

  async function produceSelected() {
    const channelIds = channels.filter((c) => pickedChannels[c.id]).map((c) => c.id);
    setProducing(true);
    setProdMsg(null);
    setError(null);
    const res = await fetch("/api/produce/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ideaIds: selectedIds, channelIds }),
    });
    const data = await res.json().catch(() => ({}));
    setProducing(false);
    if (!res.ok) {
      setError(data.error ?? "Error produciendo");
      return;
    }
    setProdMsg(
      `${data.producedIdeas ?? 0} ideas producidas · ${data.totalAssets ?? 0} creaciones generadas` +
        (data.failedIdeas ? ` · ${data.failedIdeas} con error` : "") +
        ".",
    );
    setSelected({});
    setPicking(false);
    setPickedChannels({});
    startTransition(() => router.refresh());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/ideas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title,
        rationale: form.rationale || null,
        referenceUrl: form.referenceUrl || null,
        idealFormat: form.idealFormat || null,
        status: "APPROVED",
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error creando idea");
      return;
    }
    setForm({ title: "", rationale: "", referenceUrl: "", idealFormat: "" });
    setCreating(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <label className="mr-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-input accent-primary"
          />
          Mostrar archivadas / rechazadas
        </label>
        {/* Toggle de vista tarjetas / lista */}
        <div className="inline-flex overflow-hidden rounded-md border border-border/60">
          <button
            type="button"
            onClick={() => setView("cards")}
            aria-pressed={view === "cards"}
            title="Vista de tarjetas"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${view === "cards" ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Tarjetas
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-pressed={view === "list"}
            title="Vista de lista (selección múltiple)"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${view === "list" ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
          >
            <ListIcon className="h-3.5 w-3.5" /> Lista
          </button>
        </div>
        <Button onClick={() => setCreating((v) => !v)} size="sm">
          <Plus className="h-4 w-4" /> Nueva idea
        </Button>
      </div>

      {prodMsg && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {prodMsg}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {creating && (
        <form onSubmit={create} className="glass-card grid gap-3 p-4 md:grid-cols-2">
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="i-title">Título</Label>
            <Input
              id="i-title"
              required
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="i-rat">Texto amplio (Markdown)</Label>
            <Textarea
              id="i-rat"
              rows={5}
              value={form.rationale}
              onChange={(e) => setForm({ ...form, rationale: e.target.value })}
              placeholder="Explica la idea con claridad: ángulo, ejemplos, intención..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="i-url">URL de referencia</Label>
            <Input
              id="i-url"
              type="url"
              value={form.referenceUrl}
              onChange={(e) => setForm({ ...form, referenceUrl: e.target.value })}
              placeholder="https://..."
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="i-format">Formato ideal</Label>
            <Input
              id="i-format"
              value={form.idealFormat}
              onChange={(e) => setForm({ ...form, idealFormat: e.target.value })}
              placeholder="Ej. Newsletter, Post LinkedIn, Hilo en X"
            />
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Crear
            </Button>
          </div>
        </form>
      )}

      {approved.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
          Sin ideas aprobadas todavía. Aprueba una desde <span className="font-medium">/investigacion</span> o crea una manual con el botón de arriba.
        </div>
      )}

      {/* Barra de selección (modo lista): producir en masa */}
      {view === "list" && selectedIds.length > 0 && (
        <div className="glass-card flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium">
              {selectedIds.length} seleccionadas
            </span>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => setSelected({})}>
                Deseleccionar
              </Button>
              <Button
                size="sm"
                onClick={() => setPicking((v) => !v)}
                disabled={producing}
              >
                <Sparkles className="h-4 w-4" /> Producir seleccionadas
              </Button>
            </div>
          </div>
          {picking && (
            <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-background/30 p-3">
              <p className="text-xs text-muted-foreground">
                Elige los canales para las {selectedIds.length} ideas (si no marcas
                ninguno, solo se genera el contenido base). Las creaciones que ya
                existan se saltan.
              </p>
              <div className="flex flex-wrap gap-2">
                {channels.length === 0 && (
                  <span className="text-xs text-muted-foreground">
                    No hay canales activos. Configúralos en Módulos → Canales.
                  </span>
                )}
                {channels.map((c) => (
                  <label
                    key={c.id}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/50 bg-background/40 px-2.5 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={!!pickedChannels[c.id]}
                      onChange={() =>
                        setPickedChannels((s) => ({ ...s, [c.id]: !s[c.id] }))
                      }
                      className="h-3.5 w-3.5 rounded border-input accent-primary"
                    />
                    {c.name}
                    <span className="text-[10px] uppercase text-muted-foreground">
                      {c.type}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <Button size="sm" onClick={produceSelected} disabled={producing}>
                  {producing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  Generar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Vista LISTA */}
      {view === "list" && approved.length > 0 && (
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todas"
                    checked={selectedIds.length === approved.length && approved.length > 0}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-input accent-primary"
                  />
                </th>
                <th className="px-3 py-2 text-left">Idea</th>
                <th className="px-3 py-2 text-right">Viral</th>
                <th className="px-3 py-2 text-right">Potencial</th>
                <th className="px-3 py-2 text-right">Piezas</th>
                <th className="w-8 px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {approved.map((i) => (
                <tr key={i.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={!!selected[i.id]}
                      onChange={() => toggleIdea(i.id)}
                      className="h-4 w-4 rounded border-input accent-primary"
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/ideas/${i.id}`} className="font-medium hover:text-foreground">
                      {i.title}
                    </Link>
                    {i.idealFormat && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                        {i.idealFormat}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {i.viralityScore !== null ? (i.viralityScore * 100).toFixed(0) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                    {i.potentialScore !== null ? (i.potentialScore * 100).toFixed(0) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{i.contents}</td>
                  <td className="px-3 py-2.5">
                    <Link
                      href={`/ideas/${i.id}`}
                      className="inline-flex text-muted-foreground/60 hover:text-foreground"
                      aria-label="Abrir idea"
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Vista TARJETAS */}
      <div
        className={`grid gap-3 md:grid-cols-2 xl:grid-cols-3 ${view === "list" ? "hidden" : ""}`}
      >
        {approved.map((i) => (
          <Link
            key={i.id}
            href={`/ideas/${i.id}`}
            className="group flex flex-col gap-2 rounded-xl border border-border/50 bg-background/40 p-4 transition hover:border-primary/50"
          >
            <div className="flex items-start gap-2">
              <span className="flex-1 text-sm font-semibold leading-snug group-hover:text-foreground">
                {i.title}
              </span>
              <span
                aria-label={`${i.contents} ${i.contents === 1 ? "pieza producida" : "piezas producidas"}`}
                title={`${i.contents} ${i.contents === 1 ? "pieza producida" : "piezas producidas"}`}
                className="inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/15 px-1.5 text-xs font-semibold text-foreground"
              >
                {i.contents}
              </span>
            </div>

            {i.rationale && (
              <p className="line-clamp-2 text-xs text-muted-foreground">{i.rationale}</p>
            )}

            {(i.viralityScore !== null || i.potentialScore !== null || i.idealFormat) && (
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                {i.viralityScore !== null && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-muted-foreground">
                    <Flame className="h-3 w-3 text-foreground" />
                    <span className="font-semibold text-foreground">
                      {(i.viralityScore * 100).toFixed(0)}
                    </span>
                    viral
                  </span>
                )}
                {i.potentialScore !== null && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 text-muted-foreground">
                    <TrendingUp className="h-3 w-3 text-foreground" />
                    <span className="font-semibold text-foreground">
                      {(i.potentialScore * 100).toFixed(0)}
                    </span>
                    potencial
                  </span>
                )}
                {i.idealFormat && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 text-foreground">
                    <Layers className="h-3 w-3" />
                    <span className="font-medium">{i.idealFormat}</span>
                  </span>
                )}
              </div>
            )}

            {i.referenceUrl && (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 text-[11px] text-muted-foreground">
                <LinkIcon className="h-3 w-3 shrink-0" />
                <span className="truncate">{i.referenceUrl}</span>
              </span>
            )}

            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3 w-3" />
                {i.contents} {i.contents === 1 ? "pieza" : "piezas"}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {showArchived && archived.length > 0 && (
        <section className="flex flex-col gap-2 pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Archivadas / rechazadas
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            {archived.map((i) => (
              <div key={i.id} className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/30 p-3 opacity-70">
                <Archive className="h-4 w-4 text-muted-foreground" />
                <Link href={`/ideas/${i.id}`} className="flex-1 text-sm hover:underline">
                  {i.title}
                </Link>
                <Badge variant="outline" className="text-[10px]">
                  {i.status}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
