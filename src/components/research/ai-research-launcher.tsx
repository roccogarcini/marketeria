"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Telescope, X, CheckCircle2 } from "lucide-react";

type LLMProvider = {
  providerType: string;
  displayName: string;
  supportsNativeSearch: boolean;
  isDefault: boolean;
};

/** Etiquetas legibles para mostrar qué proveedor/motor se usó. */
const PROVIDER_LABELS: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  OPENROUTER: "OpenRouter",
  CUSTOM: "Custom",
  ZAI: "z.ai (GLM)",
  DEEPSEEK: "DeepSeek",
  GEMINI: "Gemini (Google)",
};

function providerLabel(type: string): string {
  return PROVIDER_LABELS[type] ?? type;
}

function viaLabel(via: string | null | undefined): string {
  if (via === "native") return "búsqueda nativa";
  if (via === "tavily") return "Tavily";
  return "";
}

/**
 * Lanzador ad-hoc de "Investigación IA": escribes un brief, se crea una fuente
 * AI_RESEARCH y se lanza una búsqueda una vez. Reutiliza el flujo de fuentes
 * (POST /api/sources + POST /api/sources/[id]/fetch).
 */
export function AIResearchLauncher({
  open: openProp,
  onOpenChange,
  showTrigger = true,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  showTrigger?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => (onOpenChange ?? setInternalOpen)(v);

  const [brief, setBrief] = useState("");
  const [provider, setProvider] = useState("AUTO");
  const [providers, setProviders] = useState<LLMProvider[]>([]);
  const [defaultProvider, setDefaultProvider] = useState<string | null>(null);
  const [hasTavily, setHasTavily] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    usedProvider?: string | null;
    usedVia?: string | null;
    requested?: string | null;
    attempts?: string[];
  } | null>(null);

  // Al abrir, cargamos los proveedores LLM activos para poblar el selector.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/research/llm-providers")
      .then((r) => (r.ok ? r.json() : { providers: [], hasTavily: false }))
      .then((data) => {
        if (cancelled) return;
        setProviders(data.providers ?? []);
        setDefaultProvider(data.defaultProvider ?? null);
        setHasTavily(Boolean(data.hasTavily));
      })
      .catch(() => {
        if (!cancelled) setProviders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function close() {
    if (busy) return;
    setError(null);
    setResult(null);
    setBrief("");
    setProvider("AUTO");
    setOpen(false);
  }

  async function run() {
    setError(null);
    setResult(null);
    if (brief.trim().length < 8) {
      setError("Escribe un brief un poco más concreto.");
      return;
    }
    setBusy(true);
    // 1) crear la fuente AI_RESEARCH. Guardamos el proveedor elegido en
    // configJson (salvo "AUTO", que deja la selección automática con fallback).
    const name = `Investigación IA · ${brief.trim().slice(0, 40)}`;
    const cfg: { brief: string; provider?: string } = { brief: brief.trim() };
    if (provider !== "AUTO") cfg.provider = provider;
    const srcRes = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type: "AI_RESEARCH",
        configJson: JSON.stringify(cfg),
        isActive: true,
      }),
    });
    const srcData = await srcRes.json().catch(() => ({}));
    if (!srcRes.ok || !srcData.source?.id) {
      setBusy(false);
      setError(srcData.error ?? "No se pudo crear la fuente.");
      return;
    }
    // 2) lanzarla una vez
    const runRes = await fetch(`/api/sources/${srcData.source.id}/fetch`, {
      method: "POST",
    });
    const runData = await runRes.json().catch(() => ({}));
    setBusy(false);
    if (!runRes.ok) {
      setError(runData.error ?? "Error ejecutando la investigación.");
      return;
    }
    if (runData.error) {
      setError(runData.error);
      return;
    }
    setResult({
      created: runData.created ?? 0,
      skipped: runData.skipped ?? 0,
      usedProvider: runData.researchProvider ?? null,
      usedVia: runData.researchVia ?? null,
      requested: runData.researchRequested ?? null,
      attempts: runData.researchAttempts ?? [],
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
          <Telescope className="h-4 w-4" />
          Investigar con IA
        </Button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
          <div
            className="relative w-full max-w-xl rounded-2xl border border-border/60 bg-card p-6 shadow-2xl"
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

            <div className="mb-1 flex items-center gap-2">
              <Telescope className="h-5 w-5 text-foreground" />
              <h2 className="text-lg font-bold">Investigar con IA</h2>
            </div>
            <p className="mb-4 text-xs text-muted-foreground">
              Describe qué buscar; la IA busca en la web (con tu proveedor LLM o
              Tavily) y crea hallazgos reales con su URL.
            </p>

            {!result && (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="air-brief">Brief</Label>
                  <Textarea
                    id="air-brief"
                    rows={5}
                    value={brief}
                    disabled={busy}
                    onChange={(e) => setBrief(e.target.value)}
                    placeholder={`Ejemplo:\nNovedades de las últimas 2 semanas sobre "MCPs verticales en banca". Prioriza casos con métricas reales. Límite: 8 hallazgos.`}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="air-provider">Proveedor (API)</Label>
                  <select
                    id="air-provider"
                    value={provider}
                    disabled={busy}
                    onChange={(e) => setProvider(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="AUTO">
                      {defaultProvider
                        ? `Automático (por defecto: ${providerLabel(defaultProvider)})`
                        : "Automático (elige y prueba alternativas si falla)"}
                    </option>
                    {providers.map((p) => (
                      <option key={p.providerType} value={p.providerType}>
                        {p.isDefault ? "★ " : ""}
                        {providerLabel(p.providerType)}
                        {p.supportsNativeSearch
                          ? " · busca en la web"
                          : hasTavily
                            ? " · vía Tavily"
                            : " · necesita Tavily"}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground">
                    {providers.length === 0
                      ? "No hay proveedores LLM activos. Añádelos en /admin/proveedores."
                      : "En Automático prueba primero el elegido y, si falla (p. ej. sin cuota), pasa al siguiente que funcione."}
                  </p>
                </div>
                {error && (
                  <div
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {error}
                  </div>
                )}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button variant="ghost" onClick={close} disabled={busy}>
                    Cancelar
                  </Button>
                  <Button onClick={run} disabled={busy} className="gap-1.5">
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Telescope className="h-4 w-4" />
                    )}
                    Investigar
                  </Button>
                </div>
              </div>
            )}

            {result && (
              <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/10 p-4 text-sm">
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-semibold">Investigación completada</span>
                </div>
                <p>
                  <strong>{result.created}</strong> hallazgos creados,{" "}
                  <strong>{result.skipped}</strong> duplicados omitidos. Se guardó
                  como fuente para que puedas repetirla cuando quieras.
                </p>
                {result.usedProvider && (
                  <p className="text-xs text-muted-foreground">
                    Investigado con{" "}
                    <strong className="text-foreground">
                      {providerLabel(result.usedProvider)}
                    </strong>
                    {result.usedVia ? ` · ${viaLabel(result.usedVia)}` : ""}.
                  </p>
                )}
                {result.requested &&
                  result.usedProvider &&
                  result.requested !== result.usedProvider && (
                    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
                      <p>
                        <strong>{providerLabel(result.requested)}</strong> no
                        pudo completar la búsqueda, así que se usó{" "}
                        <strong>{providerLabel(result.usedProvider)}</strong> como
                        respaldo.
                      </p>
                      {result.attempts && result.attempts.length > 0 && (
                        <p className="mt-1 text-muted-foreground">
                          Motivo:{" "}
                          {result.attempts.find((a) =>
                            a
                              .toUpperCase()
                              .startsWith(result.requested!.toUpperCase()),
                          ) ?? result.attempts[0]}
                        </p>
                      )}
                    </div>
                  )}
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
