"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { Button } from "@/components/ui/button";
import { CarouselPreview } from "@/components/carousel/carousel-preview";
import { parseCarouselFiles } from "@/lib/carousel/parse";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Save,
  Sparkles,
  Share2,
  FileText,
  Copy,
  Check,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

type Asset = {
  id: string;
  body: string;
  status: string;
  scheduledAt: string | null;
  notes: string | null;
  channel: {
    id: string;
    name: string;
    type: string;
    constraintsJson: string | null;
  };
  content: {
    id: string;
    title: string;
    body: string;
    status: string;
    ideaTitle: string;
  };
};

function isFinal(status: string): boolean {
  return status === "SCHEDULED" || status === "PUBLISHED";
}

export function AssetEditor({ asset }: { asset: Asset }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState(asset.body);
  const [regenInstructions, setRegenInstructions] = useState("");
  const [busy, setBusy] = useState<"save" | "regen" | "delete" | "status" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<string>(
    asset.scheduledAt ? asset.scheduledAt.slice(0, 16) : "",
  );
  const [notes, setNotes] = useState<string>(asset.notes ?? "");

  const final = isFinal(asset.status);
  const simpleLabel = final ? "Final" : "Borrador";

  async function copy() {
    const text = asset.body;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // fallback legacy para entornos sin clipboard API
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(ta);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function saveEdition() {
    setBusy("save");
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: draftBody }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando");
      return;
    }
    setEditing(false);
    setMessage("Cambios guardados.");
    startTransition(() => router.refresh());
  }

  async function regenerate() {
    setBusy("regen");
    setError(null);
    const res = await fetch(`/api/assets/${asset.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: regenInstructions || undefined }),
    });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Error regenerando");
      return;
    }
    setDraftBody(data.asset.body);
    setRegenInstructions("");
    setMessage("Pieza regenerada por IA. Revisa y guarda si te convence.");
    startTransition(() => router.refresh());
  }

  async function remove() {
    if (!confirm("¿Eliminar esta pieza? Podrás volver a generarla desde la idea.")) return;
    setBusy("delete");
    const res = await fetch(`/api/assets/${asset.id}`, { method: "DELETE" });
    setBusy(null);
    if (!res.ok) {
      setError("Error eliminando");
      return;
    }
    startTransition(() => {
      router.push("/soportes");
      router.refresh();
    });
  }

  async function toggleFinal() {
    setBusy("status");
    setError(null);
    const next = final ? "READY" : "PUBLISHED";
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error cambiando estado");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function saveAdvanced() {
    setBusy("save");
    setError(null);
    const payload: Record<string, unknown> = {};
    const storedSched = asset.scheduledAt ?? null;
    const newSched = scheduledAt ? new Date(scheduledAt).toISOString() : null;
    if (newSched !== storedSched) payload.scheduledAt = newSched;
    if (notes !== (asset.notes ?? "")) payload.notes = notes || null;
    if (Object.keys(payload).length === 0) {
      setBusy(null);
      return;
    }
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando");
      return;
    }
    setMessage("Programación / notas actualizadas.");
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Cabecera */}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1 border-primary/30">
            <Share2 className="h-3 w-3" /> {asset.channel.type}
          </Badge>
          <Badge variant="outline" className="border-primary/30 text-foreground">
            {asset.channel.name}
          </Badge>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" /> {asset.content.ideaTitle}
          </span>
        </div>
        <h1 className="display-md">Pieza para {asset.channel.name}</h1>
      </header>

      {/* Barra de acciones principales */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy} variant="secondary" className="gap-2">
          {copied ? (
            <>
              <Check className="h-4 w-4" /> Copiado
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" /> Copiar
            </>
          )}
        </Button>
        {!editing ? (
          <Button onClick={() => { setDraftBody(asset.body); setEditing(true); }} variant="outline" className="gap-2">
            <Pencil className="h-4 w-4" /> Editar
          </Button>
        ) : (
          <>
            <Button onClick={saveEdition} disabled={busy !== null || draftBody === asset.body} className="gap-2">
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Guardar
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                setDraftBody(asset.body);
              }}
              variant="ghost"
            >
              Cancelar
            </Button>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button
            onClick={toggleFinal}
            variant={final ? "default" : "outline"}
            disabled={busy !== null}
            className="gap-1.5"
            title={final ? "Volver a borrador" : "Marcar como final"}
          >
            {busy === "status" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : final ? (
              <Check className="h-4 w-4" />
            ) : null}
            {simpleLabel}
          </Button>
          <Button onClick={remove} variant="ghost" size="icon" aria-label="Eliminar">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}

      {/* Contenido: vista o edición. La vista de carrusel se activa por el
          CONTENIDO (slides HTML detectados), no solo por el tipo del canal —
          así un canal Instagram/LinkedIn con agente carrusel también renderiza
          las imágenes en vez de enseñar el HTML crudo. */}
      {!editing ? (
        asset.channel.type === "CAROUSEL" ||
        parseCarouselFiles(asset.body).some((f) =>
          f.name.toLowerCase().endsWith(".html"),
        ) ? (
          <CarouselPreview body={asset.body} assetId={asset.id} />
        ) : (
          <article className="prose prose-sm max-w-none rounded-xl border border-border/50 bg-background/30 p-6 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
              {asset.body}
            </ReactMarkdown>
          </article>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <Textarea
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            rows={22}
            className="font-mono text-sm"
          />
        </div>
      )}

      {/* Regenerar con correcciones — siempre visible. Con instrucciones, la
          IA corrige SOBRE la versión actual (conserva lo que no pidas cambiar);
          sin instrucciones, rehace la pieza desde el contenido original. */}
      <div className="flex flex-col gap-2 rounded-xl border border-border/40 bg-background/20 p-3">
        <Label className="text-xs uppercase tracking-widest text-muted-foreground">
          Regenerar con IA
        </Label>
        <p className="text-xs text-muted-foreground">
          Escribe tus correcciones y la IA las aplica sobre esta versión
          conservando el resto. Si lo dejas vacío, rehace la pieza desde cero.
        </p>
        <Input
          value={regenInstructions}
          onChange={(e) => setRegenInstructions(e.target.value)}
          placeholder="Ej: acorta el titular del slide 3, fondo más oscuro, añade CTA final con @mimarca"
        />
        <Button onClick={regenerate} disabled={busy !== null} variant="secondary" className="gap-2 self-start">
          {busy === "regen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {regenInstructions.trim() ? "Aplicar correcciones" : `Regenerar para ${asset.channel.type}`}
        </Button>
      </div>

      {/* Detalles avanzados (colapsable) */}
      <section className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="inline-flex items-center gap-2 self-start text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          Programación y notas
        </button>
        {showAdvanced && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sched">Fecha programada</Label>
              <Input
                id="sched"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="notes">Notas internas</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </div>
            <div className="md:col-span-2">
              <Button onClick={saveAdvanced} disabled={busy !== null} variant="outline" size="sm">
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar detalles
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
