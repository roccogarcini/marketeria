"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Trash2, Check, X, Zap, Pencil, RefreshCw, Star } from "lucide-react";

type Provider = {
  id: string;
  providerType:
    | "OPENAI"
    | "ANTHROPIC"
    | "OPENROUTER"
    | "CUSTOM"
    | "ZAI"
    | "DEEPSEEK"
    | "GEMINI"
    | "APIFY"
    | "YOUTUBE"
    | "TAVILY";
  displayName: string;
  baseUrl: string | null;
  defaultModel: string | null;
  isActive: boolean;
  isDefaultResearch: boolean;
  apiKeyMasked: string;
  createdAt: string;
  updatedAt: string;
};

const TYPES = [
  "OPENAI",
  "ANTHROPIC",
  "OPENROUTER",
  "CUSTOM",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
  "APIFY",
  "YOUTUBE",
  "TAVILY",
] as const;

// baseURL por defecto que el servidor aplicará si dejas el campo vacío.
// Coincide con `DEFAULT_BASE_URLS` en src/lib/ai/api.ts.
const DEFAULT_BASE_URL_HINT: Partial<Record<Provider["providerType"], string>> = {
  OPENROUTER: "https://openrouter.ai/api/v1",
  ZAI: "https://api.z.ai/api/openai/v1",
  DEEPSEEK: "https://api.deepseek.com",
  GEMINI: "https://generativelanguage.googleapis.com/v1beta/openai",
};

// Modelo por defecto del sistema (si dejas el campo vacío). Coincide con
// DEFAULT_MODELS en src/lib/ai/api.ts.
const DEFAULT_MODEL_HINT: Partial<Record<Provider["providerType"], string>> = {
  OPENAI: "gpt-4o-mini",
  ANTHROPIC: "claude-sonnet-4-6",
  OPENROUTER: "openai/gpt-4o-mini",
  CUSTOM: "gpt-4o-mini",
  ZAI: "glm-4.6",
  DEEPSEEK: "deepseek-chat",
  GEMINI: "gemini-2.5-flash",
};
const LLM_TYPES_UI = ["OPENAI", "ANTHROPIC", "OPENROUTER", "CUSTOM", "ZAI", "DEEPSEEK", "GEMINI"];

// Las claves del GLM Coding Plan de z.ai solo autentican en su endpoint
// propio; el selector "Plan z.ai" escribe este baseUrl (vacío = API estándar).
const ZAI_CODING_BASE_URL = "https://api.z.ai/api/coding/paas/v4";

export function ProvidersManager({ initial }: { initial: Provider[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    providerType: "OPENAI" as Provider["providerType"],
    displayName: "",
    apiKey: "",
    baseUrl: "",
    defaultModel: "",
    isActive: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        baseUrl: form.baseUrl.trim() || null,
        defaultModel: form.defaultModel.trim() || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando proveedor");
      return;
    }
    setForm({ ...form, apiKey: "", displayName: "", baseUrl: "", defaultModel: "" });
    startTransition(() => router.refresh());
  }

  async function onDelete(id: string) {
    if (!confirm("¿Eliminar este proveedor? La API key cifrada se borrará.")) return;
    const res = await fetch(`/api/admin/providers/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    startTransition(() => router.refresh());
  }

  // Modelos disponibles: se piden en vivo a la API del proveedor
  // (POST /api/admin/providers/models), nunca hardcodeados.
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsMsg, setModelsMsg] = useState<string | null>(null);

  async function fetchModels(body: Record<string, unknown>): Promise<string[] | null> {
    const res = await fetch("/api/admin/providers/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!Array.isArray(data.models)) {
      setModelsMsg(data.error ?? "No se pudieron cargar los modelos");
      return null;
    }
    return data.models as string[];
  }

  async function loadModelsForForm() {
    if (!form.apiKey.trim()) {
      setModelsMsg("Escribe la API key primero.");
      return;
    }
    setLoadingModels(true);
    setModelsMsg(null);
    const models = await fetchModels({
      providerType: form.providerType,
      apiKey: form.apiKey,
      baseUrl: form.baseUrl.trim() || null,
    });
    setLoadingModels(false);
    if (models) {
      setModelOptions(models);
      setModelsMsg(
        models.length > 0
          ? `${models.length} modelos disponibles — elige o escribe.`
          : "Este proveedor no expone su catálogo — escribe el id del modelo a mano.",
      );
    }
  }

  // Edición del modelo de un proveedor ya guardado (usa la clave cifrada).
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [rowModel, setRowModel] = useState("");
  const [rowOptions, setRowOptions] = useState<string[]>([]);
  const [rowBusy, setRowBusy] = useState(false);

  async function openModelEditor(prov: Provider) {
    setEditingModelId(prov.id);
    setRowModel(prov.defaultModel ?? "");
    setRowOptions([]);
    setModelsMsg(null);
    setRowBusy(true);
    const models = await fetchModels({ providerId: prov.id });
    setRowBusy(false);
    if (models) setRowOptions(models);
  }

  async function saveRowModel(id: string) {
    setRowBusy(true);
    const res = await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultModel: rowModel.trim() || null }),
    });
    setRowBusy(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setModelsMsg(data.error ?? "No se pudo guardar el modelo");
      return;
    }
    setEditingModelId(null);
    startTransition(() => router.refresh());
  }

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<
    Record<string, { ok: boolean; msg: string }>
  >({});

  // Marca este proveedor como predeterminado para la Investigación IA (modo
  // Automático). El backend desmarca el resto en la misma transacción.
  const [defaultBusyId, setDefaultBusyId] = useState<string | null>(null);
  async function setDefaultResearch(id: string, next: boolean) {
    setDefaultBusyId(id);
    const res = await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefaultResearch: next }),
    });
    setDefaultBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo cambiar el proveedor por defecto");
      return;
    }
    startTransition(() => router.refresh());
  }

  // Cambia el plan/endpoint de z.ai (estándar ↔ coding) en una fila ya guardada
  // sin recrear el proveedor. Estándar = baseUrl null; coding = URL coding/paas.
  const [planBusyId, setPlanBusyId] = useState<string | null>(null);
  async function saveZaiPlan(id: string, plan: "standard" | "coding") {
    setPlanBusyId(id);
    const res = await fetch(`/api/admin/providers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: plan === "coding" ? ZAI_CODING_BASE_URL : null,
      }),
    });
    setPlanBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "No se pudo cambiar el plan de z.ai");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function testProvider(id: string) {
    setTestingId(id);
    setTestResult((r) => ({ ...r, [id]: undefined as never }));
    const res = await fetch(`/api/admin/providers/${id}/test`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setTestingId(null);
    setTestResult((r) => ({
      ...r,
      [id]: {
        ok: !!data.ok,
        msg: data.ok ? data.detail ?? "Funciona" : data.error ?? "Falló",
      },
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Proveedores LLM</h1>
        <p className="text-sm text-muted-foreground">
          Claves API almacenadas cifradas con AES-256-GCM. Nunca salen del servidor.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          La estrella{" "}
          <Star className="inline h-3 w-3 -translate-y-px fill-amber-400 text-amber-500" />{" "}
          marca el proveedor LLM que la Investigación IA usa por defecto (modo
          Automático). Si falla, prueba automáticamente los demás.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="glass-card grid gap-3 p-4 md:grid-cols-6">
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-type">Tipo</Label>
          <Select
            value={form.providerType}
            onValueChange={(v) => setForm({ ...form, providerType: v as Provider["providerType"] })}
          >
            <SelectTrigger id="p-type" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="p-name">Nombre</Label>
          <Input id="p-name" required value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="p-key">API Key</Label>
          <Input id="p-key" type="password" required value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
        </div>
        {form.providerType === "ZAI" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor="p-zai-plan">Plan z.ai</Label>
            <Select
              value={form.baseUrl === ZAI_CODING_BASE_URL ? "coding" : "standard"}
              onValueChange={(v) =>
                setForm({ ...form, baseUrl: v === "coding" ? ZAI_CODING_BASE_URL : "" })
              }
            >
              <SelectTrigger id="p-zai-plan" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">API estándar</SelectItem>
                <SelectItem value="coding">GLM Coding Plan</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">
              Puedes tener dos z.ai a la vez (Coding y Estándar): añádelos con
              nombres distintos.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Label htmlFor="p-base">Base URL (opcional)</Label>
            <Input
              id="p-base"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={DEFAULT_BASE_URL_HINT[form.providerType] ?? "https://..."}
            />
          </div>
        )}
        {LLM_TYPES_UI.includes(form.providerType) && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="p-model">Modelo (opcional)</Label>
            <div className="flex items-center gap-1">
              <Input
                id="p-model"
                list="provider-models"
                value={form.defaultModel}
                onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                placeholder={DEFAULT_MODEL_HINT[form.providerType] ?? "modelo…"}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 shrink-0"
                title="Cargar los modelos disponibles del proveedor (usa la API key de arriba)"
                onClick={loadModelsForForm}
                disabled={loadingModels}
              >
                {loadingModels ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
            <datalist id="provider-models">
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}
        {modelsMsg && (
          <p className="text-xs text-muted-foreground md:col-span-6">{modelsMsg}</p>
        )}
        <div className="md:col-span-6">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
          </Button>
        </div>
      </form>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">API Key</th>
              <th className="px-3 py-2 text-left">Modelo</th>
              <th className="px-3 py-2 text-left">Base URL</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-center">Por defecto (IA)</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  Sin proveedores configurados.
                </td>
              </tr>
            )}
            {initial.map((p) => (
              <tr key={p.id} className="border-t border-border/40">
                <td className="px-3 py-2">{p.providerType}</td>
                <td className="px-3 py-2">{p.displayName}</td>
                <td className="px-3 py-2 font-mono text-xs">{p.apiKeyMasked}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {editingModelId === p.id ? (
                    <div className="flex items-center gap-1">
                      <Input
                        list="row-provider-models"
                        value={rowModel}
                        onChange={(e) => setRowModel(e.target.value)}
                        placeholder={rowBusy ? "cargando modelos…" : "modelo…"}
                        className="h-8 w-48 font-mono text-xs"
                        autoFocus
                      />
                      <datalist id="row-provider-models">
                        {rowOptions.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => saveRowModel(p.id)}
                        disabled={rowBusy}
                        aria-label="Guardar modelo"
                      >
                        {rowBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Check className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setEditingModelId(null)}
                        aria-label="Cancelar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {p.defaultModel ?? "—"}
                      {LLM_TYPES_UI.includes(p.providerType) && (
                        <button
                          type="button"
                          onClick={() => openModelEditor(p)}
                          className="text-muted-foreground/70 transition hover:text-foreground"
                          aria-label="Cambiar modelo"
                          title="Cambiar modelo (carga la lista del proveedor)"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {p.providerType === "ZAI" ? (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={p.baseUrl?.includes("coding") ? "coding" : "standard"}
                        disabled={planBusyId === p.id}
                        onChange={(e) =>
                          saveZaiPlan(p.id, e.target.value as "standard" | "coding")
                        }
                        aria-label="Plan de z.ai"
                        className="h-8 rounded-md border border-input bg-transparent px-2 text-xs disabled:opacity-50"
                      >
                        <option value="standard">API estándar</option>
                        <option value="coding">GLM Coding Plan</option>
                      </select>
                      {planBusyId === p.id && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      )}
                    </div>
                  ) : (
                    p.baseUrl ?? "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={p.isActive ? "default" : "outline"}>
                    {p.isActive ? "Activo" : "Inactivo"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-center">
                  {LLM_TYPES_UI.includes(p.providerType) ? (
                    <button
                      type="button"
                      onClick={() => setDefaultResearch(p.id, !p.isDefaultResearch)}
                      disabled={defaultBusyId === p.id || !p.isActive}
                      title={
                        !p.isActive
                          ? "Actívalo para poder marcarlo por defecto"
                          : p.isDefaultResearch
                            ? "Es el predeterminado — clic para quitar"
                            : "Marcar como predeterminado de la Investigación IA"
                      }
                      aria-label="Marcar como proveedor por defecto"
                      aria-pressed={p.isDefaultResearch}
                      className="inline-flex items-center justify-center rounded-md p-1 transition hover:bg-accent/50 disabled:opacity-40"
                    >
                      {defaultBusyId === p.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Star
                          className={`h-4 w-4 ${
                            p.isDefaultResearch
                              ? "fill-amber-400 text-amber-500"
                              : "text-muted-foreground/60"
                          }`}
                        />
                      )}
                    </button>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    {testResult[p.id] && (
                      <span
                        title={testResult[p.id].msg}
                        className={`inline-flex items-center gap-1 text-xs ${
                          testResult[p.id].ok ? "text-ok" : "text-destructive"
                        }`}
                      >
                        {testResult[p.id].ok ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <X className="h-3.5 w-3.5" />
                        )}
                        <span className="max-w-[160px] truncate">{testResult[p.id].msg}</span>
                      </span>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => testProvider(p.id)}
                      disabled={testingId === p.id}
                    >
                      {testingId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Zap className="h-3.5 w-3.5" />
                      )}
                      Probar
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => onDelete(p.id)} aria-label="Eliminar">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
