"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Youtube, X, CheckCircle2, Plus } from "lucide-react";

type Source = { id: string; name: string; type: string; isActive: boolean };

const CREATE_NEW = "__create_new";

/**
 * Lanzador ad-hoc YouTube Data API (oficial, gratis dentro de la quota).
 */
export function YoutubeLauncher({
  sources,
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  sources: Source[];
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  showTrigger?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ?? setInternalOpen)(v);
  const [query, setQuery] = useState("");
  const [maxItems, setMaxItems] = useState(30);
  const [order, setOrder] = useState<
    "relevance" | "date" | "rating" | "viewCount"
  >("relevance");
  const [daysBack, setDaysBack] = useState(0);
  const [sourceId, setSourceId] = useState<string>(
    sources.find((s) => s.isActive)?.id ?? sources[0]?.id ?? CREATE_NEW,
  );
  const [newSourceName, setNewSourceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    errorsCount: number;
  } | null>(null);

  function reset() {
    setQuery("");
    setError(null);
    setResult(null);
    setNewSourceName("");
  }
  function close() {
    if (busy) return;
    reset();
    setOpen(false);
  }

  async function run() {
    setError(null);
    setResult(null);
    if (!sourceId) {
      setError("Elige una fuente destino.");
      return;
    }
    if (query.trim().length < 2) {
      setError("Escribe una query.");
      return;
    }
    setBusy(true);

    let targetSourceId = sourceId;
    if (sourceId === CREATE_NEW) {
      const autoName =
        newSourceName.trim() ||
        `YouTube · ${query.trim().slice(0, 40)}`;
      const srcRes = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: autoName,
          type: "YOUTUBE",
          configJson: JSON.stringify({
            query: query.trim(),
            maxItems,
            order,
            ...(daysBack > 0 ? { daysBack } : {}),
          }),
          isActive: true,
        }),
      });
      const srcData = await srcRes.json().catch(() => ({}));
      if (!srcRes.ok || !srcData.source?.id) {
        setBusy(false);
        setError(srcData.error ?? "No se pudo crear la source.");
        return;
      }
      targetSourceId = srcData.source.id;
    }

    const res = await fetch("/api/research/youtube/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: targetSourceId,
        query: query.trim(),
        maxItems,
        order,
        daysBack,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Error ejecutando YouTube API.");
      return;
    }
    setResult({
      created: data.created ?? 0,
      skipped: data.skipped ?? 0,
      errorsCount: data.errorsCount ?? 0,
    });
    startTransition(() => router.refresh());
  }

  return (
    <>
      {showTrigger && (
        <Button
          onClick={() => setOpen(true)}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <Youtube className="h-4 w-4" />
          Buscar en YouTube
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-2xl rounded-2xl border border-border/60 bg-card p-6 shadow-2xl"
            role="dialog"
            aria-modal
          >
            <button
              type="button"
              onClick={close}
              disabled={busy}
              aria-label="Cerrar"
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-40"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-4 flex items-center gap-2">
              <Youtube className="h-5 w-5 text-foreground" />
              <h2 className="text-lg font-bold">Buscar en YouTube</h2>
              <span className="ml-2 rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                API oficial · gratis
              </span>
            </div>

            {!result && (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="flex flex-col gap-1.5 md:col-span-3">
                  <Label htmlFor="yt-query">Query</Label>
                  <Textarea
                    id="yt-query"
                    rows={2}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={busy}
                    placeholder="Términos de búsqueda en YouTube — ej. claude code tutorial"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="yt-order">Orden</Label>
                  <Select
                    value={order}
                    onValueChange={(v) =>
                      setOrder(v as typeof order)
                    }
                    disabled={busy}
                  >
                    <SelectTrigger id="yt-order" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="relevance">Relevancia</SelectItem>
                      <SelectItem value="date">Fecha</SelectItem>
                      <SelectItem value="viewCount">Vistas</SelectItem>
                      <SelectItem value="rating">Valoración</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="yt-days">
                    Días atrás{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      (0 = sin filtro)
                    </span>
                  </Label>
                  <Input
                    id="yt-days"
                    type="number"
                    min={0}
                    max={365}
                    value={daysBack}
                    disabled={busy}
                    onChange={(e) =>
                      setDaysBack(
                        Math.max(0, Math.min(365, Number(e.target.value) || 0)),
                      )
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="yt-max">Máx vídeos</Label>
                  <Input
                    id="yt-max"
                    type="number"
                    min={1}
                    max={50}
                    value={maxItems}
                    disabled={busy}
                    onChange={(e) =>
                      setMaxItems(
                        Math.max(1, Math.min(50, Number(e.target.value) || 30)),
                      )
                    }
                  />
                </div>

                <div className="flex flex-col gap-1.5 md:col-span-3">
                  <Label htmlFor="yt-src">Fuente destino</Label>
                  <Select
                    value={sourceId}
                    onValueChange={setSourceId}
                    disabled={busy}
                  >
                    <SelectTrigger id="yt-src" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={CREATE_NEW}>
                        <span className="inline-flex items-center gap-1.5 text-foreground">
                          <Plus className="h-3 w-3" />
                          Nueva source ad-hoc
                        </span>
                      </SelectItem>
                      {sources.map((s) => (
                        <SelectItem key={s.id} value={s.id} disabled={!s.isActive}>
                          {s.name} · {s.type}
                          {!s.isActive ? " (inactiva)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {sourceId === CREATE_NEW && (
                    <Input
                      value={newSourceName}
                      onChange={(e) => setNewSourceName(e.target.value)}
                      placeholder={`YouTube · ${query.trim().slice(0, 30) || "nombre auto"}`}
                      disabled={busy}
                      className="h-9 text-xs"
                    />
                  )}
                </div>

                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive md:col-span-3"
                  >
                    {error}
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-2 md:col-span-3">
                  <Button variant="ghost" onClick={close} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button onClick={run} disabled={busy} className="gap-1.5">
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Youtube className="h-4 w-4" />
                    )}
                    Buscar
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-semibold">Búsqueda completada</span>
                </div>
                <p>
                  <strong>{result.created}</strong> hallazgos creados,{" "}
                  <strong>{result.skipped}</strong> duplicados omitidos.
                  {result.errorsCount > 0 && (
                    <>
                      {" "}
                      <span className="text-destructive">
                        {result.errorsCount} items sin datos suficientes.
                      </span>
                    </>
                  )}
                </p>
                <div className="flex justify-end">
                  <Button size="sm" onClick={close}>
                    Ver en bandeja
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
