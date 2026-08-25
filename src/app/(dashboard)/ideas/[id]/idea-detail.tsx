"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MaterialBadge } from "@/components/research/material-badge";
import {
  Loader2,
  Save,
  Sparkles,
  LinkIcon,
  Flame,
  TrendingUp,
  Layers,
  ExternalLink,
  Share2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Trash2,
  AlertTriangle,
  FileText,
} from "lucide-react";

type Comment = { id: string; body: string; createdAt: string; userName: string };
type Idea = {
  id: string;
  title: string;
  angle: string | null;
  rationale: string | null;
  status: string;
  referenceUrl: string | null;
  viralityScore: number | null;
  viralityReason: string | null;
  potentialScore: number | null;
  potentialReason: string | null;
  idealFormat: string | null;
  insightTitle: string | null;
  updatedAt: string;
  comments: Comment[];
};
type Channel = { id: string; name: string; type: string; hasAsset: boolean };
type ExistingAsset = {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  status: string;
  body: string;
};
type ContentRef = { id: string; title: string; status: string };

// Acciones de estado disponibles según el estado actual (espejo de las
// transiciones validadas en /api/ideas/[id]/status).
const STATUS_ACTIONS: Record<string, Array<{ to: string; label: string }>> = {
  DRAFT: [{ to: "PROPOSED", label: "Proponer" }],
  PROPOSED: [
    { to: "APPROVED", label: "Aprobar" },
    { to: "REJECTED", label: "Rechazar" },
  ],
  APPROVED: [{ to: "ARCHIVED", label: "Archivar" }],
  REJECTED: [{ to: "ARCHIVED", label: "Archivar" }],
  ARCHIVED: [{ to: "PROPOSED", label: "Recuperar" }],
};

function simplifiedStatus(s: string): "Borrador" | "Final" {
  return s === "SCHEDULED" || s === "PUBLISHED" ? "Final" : "Borrador";
}

export function IdeaDetail({
  idea,
  channels,
  existingAssets,
  contents,
  material,
}: {
  idea: Idea;
  channels: Channel[];
  existingAssets: ExistingAsset[];
  contents: ContentRef[];
  material: {
    level: import("@/lib/research/material").MaterialLevel;
    findingId: string;
    hasUrl: boolean;
  } | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // Edición de la idea (solo campos editables — scoring es read-only)
  const [title, setTitle] = useState(idea.title);
  const [rationale, setRationale] = useState(idea.rationale ?? "");
  const [referenceUrl, setReferenceUrl] = useState(idea.referenceUrl ?? "");
  const [idealFormat, setIdealFormat] = useState(idea.idealFormat ?? "");

  const [savingIdea, setSavingIdea] = useState(false);
  const [ideaMsg, setIdeaMsg] = useState<string | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);

  const dirty =
    title !== idea.title ||
    rationale !== (idea.rationale ?? "") ||
    referenceUrl !== (idea.referenceUrl ?? "") ||
    idealFormat !== (idea.idealFormat ?? "");

  async function saveIdea() {
    setSavingIdea(true);
    setIdeaMsg(null);
    setIdeaError(null);
    const payload: Record<string, unknown> = {};
    if (title !== idea.title) payload.title = title;
    if (rationale !== (idea.rationale ?? "")) payload.rationale = rationale || null;
    if (referenceUrl !== (idea.referenceUrl ?? ""))
      payload.referenceUrl = referenceUrl || null;
    if (idealFormat !== (idea.idealFormat ?? ""))
      payload.idealFormat = idealFormat || null;

    const res = await fetch(`/api/ideas/${idea.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSavingIdea(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setIdeaError(data.error ?? "Error al guardar");
      return;
    }
    setIdeaMsg("Idea actualizada.");
    startTransition(() => router.refresh());
  }

  // Borrado de la idea (cascada: contenidos, versiones, soportes, comentarios)
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const contentsCount = existingAssets.length; // proxy: hay piezas si hay assets

  async function deleteIdea() {
    // Aviso fuerte si hay contenidos producidos. La cascada borra Content,
    // ContentVersion, Asset e IdeaComment. Es destructivo e irreversible.
    const baseMsg = `Vas a eliminar la idea "${idea.title}". Esto borrará también todos los contenidos creados a partir de ella, sus versiones y sus piezas. ¿Continuar?`;
    if (!confirm(baseMsg)) return;
    if (contentsCount > 0) {
      const second = confirm(
        `Confirmación final: hay ${contentsCount} pieza(s) producida(s) que también se eliminarán. ¿Seguro?`,
      );
      if (!second) return;
    }
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/ideas/${idea.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleting(false);
      setDeleteError(data.error ?? "No se pudo eliminar la idea.");
      return;
    }
    // Volvemos a la lista de ideas. Pasamos `?deleted=<title>` por si en el
    // futuro queremos un toast en /ideas confirmando el borrado.
    router.push(`/ideas?deleted=${encodeURIComponent(idea.title)}`);
  }

  // Producción de soportes (vía proveedor LLM configurado)
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [producing, setProducing] = useState(false);
  const [prodMsg, setProdMsg] = useState<string | null>(null);
  const [prodError, setProdError] = useState<string | null>(null);

  const selectedChannelIds = useMemo(
    () => channels.filter((c) => checked[c.id] && !c.hasAsset).map((c) => c.id),
    [channels, checked],
  );

  function toggle(id: string) {
    setChecked((s) => ({ ...s, [id]: !s[id] }));
  }

  async function produceSelected() {
    if (selectedChannelIds.length === 0) return;
    setProducing(true);
    setProdError(null);
    setProdMsg(null);

    const res = await fetch("/api/produce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ideaId: idea.id,
        channelIds: selectedChannelIds,
      }),
    });
    setProducing(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setProdError(data.error ?? "Error al producir");
      return;
    }
    const ok = (data.results ?? []).filter((r: { asset?: unknown }) => r.asset).length;
    const failed = (data.results ?? []).filter((r: { error?: unknown }) => r.error).length;
    const parts: string[] = [];
    if (ok > 0) parts.push(`${ok} piezas generadas`);
    if (failed > 0) parts.push(`${failed} con error`);
    setProdMsg(parts.length > 0 ? parts.join(" · ") : "Sin cambios.");
    setChecked({});
    startTransition(() => router.refresh());
  }

  // Cambio de estado (archivar / rechazar / recuperar…)
  const [statusBusy, setStatusBusy] = useState(false);

  async function changeStatus(to: string, label: string) {
    if (to === "ARCHIVED" && !confirm(`¿${label} la idea "${idea.title}"?`)) return;
    setStatusBusy(true);
    setIdeaError(null);
    setIdeaMsg(null);
    const res = await fetch(`/api/ideas/${idea.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: to }),
    });
    setStatusBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setIdeaError(data.error ?? "No se pudo cambiar el estado.");
      return;
    }
    setIdeaMsg(`Idea ${to === "ARCHIVED" ? "archivada" : to === "REJECTED" ? "rechazada" : "actualizada"}.`);
    startTransition(() => router.refresh());
  }

  // Comentarios
  const [showComments, setShowComments] = useState(false);
  const [comment, setComment] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    setCommentBusy(true);
    const res = await fetch(`/api/ideas/${idea.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: comment }),
    });
    setCommentBusy(false);
    if (!res.ok) return;
    setComment("");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cabecera */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <Badge
            variant="outline"
            className={
              idea.status === "APPROVED" ? "border-primary/40 text-foreground" : undefined
            }
          >
            {idea.status}
          </Badge>
          {idea.insightTitle && (
            <span className="text-[10px]">desde: {idea.insightTitle}</span>
          )}
          <span className="flex-1" />
          {(STATUS_ACTIONS[idea.status] ?? []).map((a) => (
            <Button
              key={a.to}
              type="button"
              variant="outline"
              size="sm"
              disabled={statusBusy}
              onClick={() => changeStatus(a.to, a.label)}
              className="h-7 text-[11px] normal-case tracking-normal"
            >
              {statusBusy && <Loader2 className="h-3 w-3 animate-spin" />}
              {a.label}
            </Button>
          ))}
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-auto border-none bg-transparent px-0 font-sans text-3xl font-medium focus-visible:ring-0"
          placeholder="Título de la idea"
        />
      </header>

      {ideaError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {ideaError}
        </div>
      )}
      {ideaMsg && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {ideaMsg}
        </div>
      )}

      {/* URL + formato + scoring */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ref-url" className="text-xs uppercase tracking-widest text-muted-foreground">
            URL de referencia
          </Label>
          <div className="relative">
            <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="ref-url"
              type="url"
              value={referenceUrl}
              onChange={(e) => setReferenceUrl(e.target.value)}
              placeholder="https://..."
              className="pl-9"
            />
            {referenceUrl && (
              <a
                href={referenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title="Abrir"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ideal-fmt" className="text-xs uppercase tracking-widest text-muted-foreground">
            Formato ideal
          </Label>
          <div className="relative">
            <Layers className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground" />
            <Input
              id="ideal-fmt"
              value={idealFormat}
              onChange={(e) => setIdealFormat(e.target.value)}
              placeholder="Post LinkedIn, Newsletter, Hilo..."
              className="pl-9"
            />
          </div>
        </div>

      </div>

      {/* Scoring read-only con razón explicativa */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-foreground">
                <Flame className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Viralidad
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  Capacidad de replicarse y compartirse
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-foreground">
                {idea.viralityScore !== null
                  ? Math.round(idea.viralityScore * 100)
                  : "–"}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {idea.viralityReason ??
              "Aún sin análisis. La razón se genera al promocionar la idea desde un insight."}
          </p>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border/50 bg-background/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-foreground">
                <TrendingUp className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Potencialidad
                </p>
                <p className="text-[10px] text-muted-foreground/80">
                  Impacto esperado en negocio y audiencia
                </p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-2xl font-bold text-foreground">
                {idea.potentialScore !== null
                  ? Math.round(idea.potentialScore * 100)
                  : "–"}
              </span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {idea.potentialReason ??
              "Aún sin análisis. La razón se genera al promocionar la idea desde un insight."}
          </p>
        </div>
      </div>

      {/* Texto amplio */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="rationale" className="text-xs uppercase tracking-widest text-muted-foreground">
          Texto amplio
        </Label>
        <Textarea
          id="rationale"
          rows={10}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Explica la idea con detalle (Markdown): ángulo, datos, ejemplos, CTA…"
          className="font-mono text-sm"
        />
      </div>

      <div>
        <Button onClick={saveIdea} disabled={!dirty || savingIdea}>
          {savingIdea ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Guardar cambios
        </Button>
      </div>

      {/* Producir creaciones */}
      <section className="flex flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] via-background/20 to-background/10 p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-foreground/90">
              Producir creaciones
            </h2>
            <p className="text-xs text-muted-foreground">
              Marca los canales que quieras y genera todas las piezas a la vez. Los ya producidos se saltan.
            </p>
          </div>
        </div>

        {/* Semáforo de materia prima: con poco material, la IA rellenaría. */}
        {material && (
          <MaterialBadge
            level={material.level}
            findingId={material.findingId}
            canEnrich={material.hasUrl}
          />
        )}

        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay canales activos. Configúralos desde <span className="font-medium">Módulos → Canales</span>.
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {channels.map((c) => {
              const produced = c.hasAsset;
              return (
                <label
                  key={c.id}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition ${
                    produced
                      ? "cursor-not-allowed border-border/30 bg-background/20 opacity-60"
                      : checked[c.id]
                        ? "border-primary/60 bg-primary/[0.08]"
                        : "border-border/50 bg-background/40 hover:border-primary/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!!checked[c.id] && !produced}
                    disabled={produced}
                    onChange={() => toggle(c.id)}
                    className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{c.name}</span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {c.type}
                    </span>
                  </div>
                  {produced && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-foreground" aria-label="Ya producido" />
                  )}
                </label>
              );
            })}
          </div>
        )}

        {/* Botón Producir */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/40 bg-background/30 p-3 md:flex-row md:items-center md:justify-between">
          <span className="text-[10px] text-muted-foreground">
            Las piezas se generan con el proveedor LLM configurado en{" "}
            <span className="font-medium">/admin/proveedores</span>.
          </span>
          <Button
            onClick={produceSelected}
            disabled={selectedChannelIds.length === 0 || producing}
            className="h-12 min-w-[220px] gap-2 bg-primary/95 shadow-lg shadow-primary/25 hover:bg-primary"
          >
            {producing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {selectedChannelIds.length === 0
              ? "Marca un canal"
              : `Producir (${selectedChannelIds.length})`}
          </Button>
        </div>
        {prodError && <span className="text-sm text-destructive">{prodError}</span>}
        {prodMsg && <span className="text-sm text-foreground">{prodMsg}</span>}
      </section>

      {/* Contenido base — editor completo con versiones y regeneración IA */}
      {contents.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Contenido base
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {contents.map((c) => (
              <Link
                key={c.id}
                href={`/produccion/${c.id}`}
                className="group flex items-center gap-3 rounded-xl border border-border/50 bg-background/40 p-3 transition hover:border-primary/50"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-foreground">
                  <FileText className="h-3.5 w-3.5" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{c.title}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Editar · versiones · regenerar IA
                  </span>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {c.status}
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Piezas producidas */}
      {existingAssets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Piezas producidas
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {existingAssets.map((a) => {
              const simple = simplifiedStatus(a.status);
              return (
                <Link
                  key={a.id}
                  href={`/soportes/${a.id}`}
                  className="group flex items-start gap-3 rounded-xl border border-border/50 bg-background/40 p-3 transition hover:border-primary/50"
                >
                  <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-foreground">
                    <Share2 className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{a.channelName}</span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        {a.channelType}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {a.channelType === "CAROUSEL"
                        ? "Carrusel (slides HTML) — abre la pieza para previsualizarlo."
                        : `${a.body.replace(/^#+\s*/gm, "").slice(0, 140)}…`}
                    </p>
                  </div>
                  <Badge
                    variant={simple === "Final" ? "default" : "outline"}
                    className="shrink-0 text-[10px]"
                  >
                    {simple}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Comentarios */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowComments((v) => !v)}
          className="inline-flex items-center gap-2 self-start text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {showComments ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Comentarios ({idea.comments.length})
        </button>
        {showComments && (
          <div className="flex flex-col gap-2">
            {idea.comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-border/40 bg-background/30 p-3 text-sm">
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span className="font-medium">{c.userName}</span>
                  <span>{new Date(c.createdAt).toLocaleString("es-ES")}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            <form onSubmit={postComment} className="flex flex-col gap-2">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Deja un comentario…"
                rows={2}
              />
              <div>
                <Button type="submit" size="sm" disabled={commentBusy || !comment.trim()}>
                  {commentBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Comentar
                </Button>
              </div>
            </form>
          </div>
        )}
      </section>

      {/* Zona de borrado — destructivo, separado al final para no clickar sin querer */}
      <section className="mt-4 flex flex-col gap-3 rounded-2xl border border-destructive/30 bg-destructive/[0.04] p-5">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/15 text-destructive">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-destructive">
              Eliminar idea
            </h2>
            <p className="text-xs text-muted-foreground">
              Borra esta idea y, en cascada, todos sus contenidos, versiones, piezas (creaciones) y comentarios. Acción irreversible.
            </p>
          </div>
        </div>
        {deleteError && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {deleteError}
          </div>
        )}
        <div>
          <Button
            type="button"
            variant="destructive"
            onClick={deleteIdea}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Eliminar idea
          </Button>
        </div>
      </section>
    </div>
  );
}
