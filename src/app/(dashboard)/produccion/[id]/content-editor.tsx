"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Sparkles, CheckCircle, XCircle } from "lucide-react";

type Version = {
  id: string;
  version: number;
  notes: string | null;
  isMilestone: boolean;
  createdAt: string;
  body: string;
};

type Content = {
  id: string;
  title: string;
  body: string;
  status: string;
  currentVersion: number;
  ideaTitle: string;
  ideaId: string;
  versions: Version[];
};

export function ContentEditor({ content }: { content: Content }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(content.title);
  const [body, setBody] = useState(content.body);
  const [notes, setNotes] = useState("");
  const [isMilestone, setIsMilestone] = useState(false);
  const [regenInstructions, setRegenInstructions] = useState("");
  const [busy, setBusy] = useState<"save" | "regen" | "decide" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showingVersion, setShowingVersion] = useState<Version | null>(null);

  const dirty = title !== content.title || body !== content.body;

  async function save() {
    setBusy("save");
    setError(null);
    setMessage(null);
    const payload: Record<string, unknown> = {};
    if (title !== content.title) payload.title = title;
    if (body !== content.body) payload.body = body;
    if (notes) payload.notes = notes;
    if (isMilestone) payload.isMilestone = true;
    const res = await fetch(`/api/contents/${content.id}`, {
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
    setMessage("Cambios guardados. Nueva versión creada.");
    setNotes("");
    setIsMilestone(false);
    startTransition(() => router.refresh());
  }

  async function regenerate() {
    setBusy("regen");
    setError(null);
    const res = await fetch(`/api/contents/${content.id}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: regenInstructions || undefined }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error regenerando");
      return;
    }
    const data = await res.json();
    setBody(data.content.body);
    setRegenInstructions("");
    setMessage("Contenido regenerado por IA. Nueva versión guardada.");
    startTransition(() => router.refresh());
  }

  async function decide(status: "APPROVED" | "REJECTED") {
    setBusy("decide");
    setError(null);
    const res = await fetch(`/api/contents/${content.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setBusy(null);
    if (!res.ok) {
      setError("Error al cambiar estado");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline">{content.status}</Badge>
          <Badge variant="outline">v{content.currentVersion}</Badge>
          <span className="text-xs text-muted-foreground">
            Idea: {content.ideaTitle}
          </span>
        </div>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="!text-3xl font-sans font-medium h-auto border-none px-0 bg-transparent"
        />
      </header>

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

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={24}
            className="font-mono text-sm"
          />
          <div className="glass-card flex flex-col gap-2 p-3">
            <Input
              placeholder="Notas de esta versión (opcional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={isMilestone}
                onChange={(e) => setIsMilestone(e.target.checked)}
                className="accent-primary"
              />
              Marcar como hito
            </label>
            <div className="flex gap-2">
              <Button onClick={save} disabled={!dirty || busy !== null}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar
              </Button>
              <Button variant="outline" onClick={() => decide("APPROVED")} disabled={busy !== null || content.status === "APPROVED"}>
                <CheckCircle className="h-4 w-4" /> Validar
              </Button>
              <Button variant="outline" onClick={() => decide("REJECTED")} disabled={busy !== null || content.status === "REJECTED"}>
                <XCircle className="h-4 w-4" /> Rechazar
              </Button>
            </div>
          </div>
          <div className="glass-card flex flex-col gap-2 p-3">
            <label className="text-xs font-medium">Regenerar con IA</label>
            <Input
              value={regenInstructions}
              onChange={(e) => setRegenInstructions(e.target.value)}
              placeholder="Instrucciones (ej: acortar, más casual, incluir datos)"
            />
            <Button onClick={regenerate} disabled={busy !== null} variant="secondary">
              {busy === "regen" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Regenerar
            </Button>
          </div>
        </div>

        <aside className="glass-card flex flex-col gap-2 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Historial de versiones
          </h3>
          {content.versions.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setShowingVersion(v)}
              className="flex flex-col items-start gap-1 rounded-md border border-transparent p-2 text-left hover:border-primary/30 hover:bg-accent/30"
            >
              <div className="flex items-center gap-2">
                <Badge variant={v.isMilestone ? "default" : "outline"} className="text-[10px]">
                  v{v.version}
                </Badge>
                {v.isMilestone && <span className="text-[10px] text-foreground">hito</span>}
              </div>
              <p className="line-clamp-1 text-xs text-muted-foreground">{v.notes ?? "—"}</p>
              <span className="text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleString("es-ES")}</span>
            </button>
          ))}
        </aside>
      </div>

      {showingVersion && (
        <div className="glass-card flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Versión v{showingVersion.version}</h3>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBody(showingVersion.body);
                  setShowingVersion(null);
                }}
              >
                Restaurar en editor
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowingVersion(null)}>
                Cerrar
              </Button>
            </div>
          </div>
          <pre className="overflow-auto rounded-md bg-muted/30 p-3 font-mono text-xs">{showingVersion.body}</pre>
        </div>
      )}
    </div>
  );
}
