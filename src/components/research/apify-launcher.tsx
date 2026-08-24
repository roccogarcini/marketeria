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
import { Loader2, Share2, X, CheckCircle2, Plus } from "lucide-react";
import {
  PLATFORM_LIST,
  PLATFORMS,
  type Platform,
  type FilterValue,
} from "@/lib/apify/platforms";
import {
  ApifyFiltersForm,
  defaultFiltersFor,
} from "@/components/research/apify-filters-form";

type Source = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  // Sólo presentes si la fuente es APIFY ya configurada. Los usamos para
  // pre-rellenar el formulario y que el usuario no tenga que repetir lo
  // que ya guardó al crear la fuente.
  platform?: string | null;
  configJson?: string | null;
};

/** Valor centinela para "crear nueva source al vuelo". */
const CREATE_NEW = "__create_new";

/**
 * Parsea el `configJson` de una source APIFY para pre-rellenar el formulario.
 * Acepta el shape `{query, maxItems?, actorId?, filters?}` que escribe la UI
 * de fuentes (`sources-manager.tsx`). Cualquier campo ausente se devuelve
 * como undefined para que el caller decida qué hacer.
 */
function parseApifyConfig(configJson: string | null | undefined): {
  query?: string;
  maxItems?: number;
  actorId?: string;
  filters?: Record<string, FilterValue>;
} {
  if (!configJson) return {};
  try {
    const cfg = JSON.parse(configJson) as {
      query?: unknown;
      maxItems?: unknown;
      actorId?: unknown;
      filters?: unknown;
    };
    const out: ReturnType<typeof parseApifyConfig> = {};
    if (typeof cfg.query === "string") out.query = cfg.query;
    if (typeof cfg.maxItems === "number") out.maxItems = cfg.maxItems;
    if (typeof cfg.actorId === "string") out.actorId = cfg.actorId;
    if (cfg.filters && typeof cfg.filters === "object" && !Array.isArray(cfg.filters)) {
      out.filters = cfg.filters as Record<string, FilterValue>;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Lanzador ad-hoc para buscar en redes sociales vía Apify.
 * Modal: platform picker + query + max items + source destino.
 * Llama a /api/research/apify/run y muestra el resultado.
 */
export function ApifyLauncher({
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
  // Selección inicial: la primera source APIFY activa para que el formulario
  // arranque ya pre-cargado (así no hay que reescribir los hashtags que la
  // fuente ya tiene). Si no hay ninguna APIFY,
  // caemos a la primera source activa cualquiera, y si tampoco, "crear nueva".
  const initialSourceId =
    sources.find((s) => s.isActive && s.type === "APIFY")?.id ??
    sources.find((s) => s.isActive)?.id ??
    sources[0]?.id ??
    CREATE_NEW;
  const initialSrc = sources.find((s) => s.id === initialSourceId);
  const initialIsApify =
    initialSrc?.type === "APIFY" && !!initialSrc.platform;
  const initialPlatform: Platform = initialIsApify
    ? (initialSrc!.platform as Platform)
    : "INSTAGRAM";
  const initialCfg = initialIsApify
    ? parseApifyConfig(initialSrc?.configJson)
    : {};

  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [query, setQuery] = useState(initialCfg.query ?? "");
  const [maxItems, setMaxItems] = useState(initialCfg.maxItems ?? 30);
  const [actorId, setActorId] = useState<string>(initialCfg.actorId ?? "");
  const [filters, setFilters] = useState<Record<string, FilterValue>>(() => ({
    ...defaultFiltersFor(initialPlatform),
    ...(initialCfg.filters ?? {}),
  }));
  const [sourceId, setSourceId] = useState<string>(initialSourceId);
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
      setError("Escribe una query (hashtags, keywords o URLs).");
      return;
    }
    setBusy(true);

    // Si el usuario eligió "+ Nueva source ad-hoc", la creamos primero y
    // usamos su ID. Nombre auto-generado (editable) con plataforma + query.
    let targetSourceId = sourceId;
    if (sourceId === CREATE_NEW) {
      const autoName =
        newSourceName.trim() ||
        `Apify · ${PLATFORMS[platform].label} · ${query.trim().slice(0, 40)}`;
      const srcRes = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: autoName,
          type: "APIFY",
          platform,
          configJson: JSON.stringify({
            query: query.trim(),
            maxItems,
            ...(actorId.trim() ? { actorId: actorId.trim() } : {}),
            filters,
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

    const res = await fetch("/api/research/apify/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceId: targetSourceId,
        platform,
        query: query.trim(),
        maxItems,
        ...(actorId.trim() ? { actorId: actorId.trim() } : {}),
        filters,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Error ejecutando Apify.");
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
          <Share2 className="h-4 w-4" />
          Buscar en redes (Apify)
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
              <Share2 className="h-5 w-5 text-foreground" />
              <h2 className="text-lg font-bold">Buscar en redes sociales</h2>
            </div>

            {!result && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ap-platform">Plataforma</Label>
                  <Select
                    value={platform}
                    onValueChange={(v) => {
                      const next = v as Platform;
                      setPlatform(next);
                      // Cada plataforma tiene sus propios filtros — reset al cambiar.
                      setFilters(defaultFiltersFor(next));
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger id="ap-platform" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_LIST.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLATFORMS[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ap-src">Fuente destino</Label>
                  <Select
                    value={sourceId}
                    onValueChange={(newId) => {
                      setSourceId(newId);
                      // Si la nueva fuente es APIFY y ya tiene config guardada,
                      // pre-rellenamos el formulario con esos valores. Así el
                      // usuario no tiene que re-teclear hashtags/query/filtros
                      // que ya guardó al crear la fuente.
                      const src = sources.find((s) => s.id === newId);
                      if (src?.type === "APIFY" && src.platform) {
                        const nextPlatform = src.platform as Platform;
                        const cfg = parseApifyConfig(src.configJson);
                        setPlatform(nextPlatform);
                        setQuery(cfg.query ?? "");
                        setMaxItems(cfg.maxItems ?? 30);
                        setActorId(cfg.actorId ?? "");
                        setFilters({
                          ...defaultFiltersFor(nextPlatform),
                          ...(cfg.filters ?? {}),
                        });
                      }
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger id="ap-src" className="h-9">
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
                      placeholder={`Apify · ${PLATFORMS[platform].label} · ${query.trim().slice(0, 30) || "nombre auto"}`}
                      disabled={busy}
                      className="h-9 text-xs"
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="ap-query">
                    Query{" "}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {PLATFORMS[platform].queryHint}
                    </span>
                  </Label>
                  <Textarea
                    id="ap-query"
                    rows={3}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={busy}
                    placeholder={PLATFORMS[platform].queryHint}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ap-max">Máx items</Label>
                  <Input
                    id="ap-max"
                    type="number"
                    min={1}
                    max={100}
                    value={maxItems}
                    disabled={busy}
                    onChange={(e) =>
                      setMaxItems(
                        Math.max(1, Math.min(100, Number(e.target.value) || 30)),
                      )
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="ap-actor">
                    Actor ID{" "}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (vacío = actor por defecto)
                    </span>
                  </Label>
                  <Input
                    id="ap-actor"
                    type="text"
                    disabled={busy}
                    value={actorId}
                    onChange={(e) => setActorId(e.target.value)}
                    placeholder={PLATFORMS[platform].defaultActorId}
                    className="h-9 font-mono text-xs"
                  />
                </div>
                <div className="md:col-span-2">
                  <ApifyFiltersForm
                    platform={platform}
                    value={filters}
                    onChange={setFilters}
                    disabled={busy}
                  />
                </div>
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive md:col-span-2"
                  >
                    {error}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 pt-2 md:col-span-2">
                  <Button variant="ghost" onClick={close} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button onClick={run} disabled={busy} className="gap-1.5">
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Share2 className="h-4 w-4" />
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
