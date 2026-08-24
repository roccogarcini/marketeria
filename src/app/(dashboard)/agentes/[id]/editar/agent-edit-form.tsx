"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Loader2, Check, RefreshCw } from "lucide-react";
import { AGENT_ICONS, AgentIcon } from "@/components/agent/agent-icon";

type AgentDraft = {
  id: string;
  slug: string;
  name: string;
  role: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  icon: string | null;
  isActive: boolean;
  providerId: string | null;
  modelId: string | null;
};

type ProviderRef = {
  id: string;
  displayName: string;
  providerType: string;
  defaultModel: string | null;
  isActive: boolean;
};

export function AgentEditForm({
  agent,
  providers,
}: {
  agent: AgentDraft;
  providers: ProviderRef[];
}) {
  const router = useRouter();
  const [form, setForm] = useState<AgentDraft>(agent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Catálogo de modelos del proveedor seleccionado (para el datalist).
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsNote, setModelsNote] = useState<string | null>(null);

  const selectedProvider = providers.find((p) => p.id === form.providerId) ?? null;

  async function loadModels(providerId: string) {
    setModels([]);
    setModelsNote(null);
    if (!providerId) return;
    setModelsLoading(true);
    try {
      const res = await fetch("/api/admin/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId }),
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.models) && data.models.length > 0) {
        setModels(data.models);
      } else {
        setModelsNote(
          data.error ?? "No se pudo listar el catálogo; escribe el id del modelo a mano.",
        );
      }
    } catch {
      setModelsNote("No se pudo listar el catálogo; escribe el id del modelo a mano.");
    } finally {
      setModelsLoading(false);
    }
  }

  // Carga el catálogo del proveedor ya asignado al abrir la ficha.
  useEffect(() => {
    if (agent.providerId) loadModels(agent.providerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/agents/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          role: form.role,
          systemPrompt: form.systemPrompt,
          temperature: form.temperature,
          maxTokens: form.maxTokens,
          icon: form.icon,
          isActive: form.isActive,
          providerId: form.providerId,
          modelId: form.modelId?.trim() ? form.modelId.trim() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "No se pudo guardar el agente.");
      }
      setSaved(true);
      router.refresh();
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="glass-card grid gap-4 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nombre</Label>
          <Input
            id="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="role">Rol</Label>
          <Input
            id="role"
            required
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1.5 md:col-span-2">
          <Label htmlFor="systemPrompt">System prompt</Label>
          <Textarea
            id="systemPrompt"
            required
            rows={12}
            value={form.systemPrompt}
            onChange={(e) =>
              setForm({ ...form, systemPrompt: e.target.value })
            }
            className="font-mono text-xs leading-relaxed"
          />
          <span className="text-[10px] text-muted-foreground">
            {form.systemPrompt.length.toLocaleString("es-ES")} caracteres · máx 20.000
          </span>
        </div>
      </div>

      {/* Proveedor + modelo por agente */}
      <div className="glass-card grid gap-4 p-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <h2 className="text-sm font-semibold">Modelo (LLM)</h2>
          <p className="text-[11px] text-muted-foreground">
            Deja &quot;Por defecto&quot; para que use el orden global de
            proveedores, o fija un proveedor y modelo concretos para este agente
            (p. ej. un modelo potente para carruseles y uno barato para otro).
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="providerId">Proveedor</Label>
          <select
            id="providerId"
            value={form.providerId ?? ""}
            onChange={(e) => {
              const providerId = e.target.value || null;
              setForm({ ...form, providerId, modelId: null });
              if (providerId) loadModels(providerId);
              else {
                setModels([]);
                setModelsNote(null);
              }
            }}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">Por defecto (orden global)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.isActive}>
                {p.displayName} ({p.providerType})
                {p.isActive ? "" : " · inactivo"}
              </option>
            ))}
          </select>
          {providers.length === 0 && (
            <span className="text-[10px] text-amber-500">
              No hay proveedores LLM. Añádelos en /admin/proveedores.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="modelId">Modelo</Label>
            {form.providerId && (
              <button
                type="button"
                onClick={() => form.providerId && loadModels(form.providerId)}
                disabled={modelsLoading}
                className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {modelsLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="h-3 w-3" />
                )}
                Cargar catálogo
              </button>
            )}
          </div>
          <Input
            id="modelId"
            list="agent-model-list"
            value={form.modelId ?? ""}
            disabled={!form.providerId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value })}
            placeholder={
              selectedProvider?.defaultModel
                ? `por defecto: ${selectedProvider.defaultModel}`
                : "modelo por defecto del proveedor"
            }
          />
          <datalist id="agent-model-list">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelsNote && (
            <span className="text-[10px] text-muted-foreground">{modelsNote}</span>
          )}
          {!form.providerId && (
            <span className="text-[10px] text-muted-foreground">
              Elige un proveedor para fijar el modelo.
            </span>
          )}
        </div>
      </div>

      <div className="glass-card grid gap-5 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="temperature">Temperatura</Label>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {form.temperature.toFixed(2)}
            </span>
          </div>
          <Slider
            id="temperature"
            value={[form.temperature]}
            min={0}
            max={2}
            step={0.05}
            onValueChange={(v) =>
              setForm({ ...form, temperature: Number((v[0] ?? 0.7).toFixed(2)) })
            }
          />
          <span className="text-[10px] text-muted-foreground">
            Más bajo = más determinista. Más alto = más creativo. 0.4-0.7 es el rango habitual.
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="maxTokens">Max tokens (respuesta)</Label>
          <Input
            id="maxTokens"
            type="number"
            min={1}
            max={16000}
            value={form.maxTokens}
            onChange={(e) =>
              setForm({
                ...form,
                maxTokens: Math.max(1, Math.min(16000, Number(e.target.value) | 0)),
              })
            }
            className="w-32"
          />
        </div>

        <div className="flex flex-col gap-2 md:col-span-2">
          <Label>Icono</Label>
          <div className="flex flex-wrap gap-2">
            {AGENT_ICONS.map(({ name }) => (
              <button
                key={name}
                type="button"
                onClick={() => setForm({ ...form, icon: name })}
                aria-label={name}
                title={name}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border transition ${
                  form.icon === name
                    ? "border-primary bg-primary/15 text-foreground dark:border-accent-soft"
                    : "border-border/40 bg-background/40 text-muted-foreground hover:bg-background/70 hover:text-foreground"
                }`}
              >
                <AgentIcon name={name} className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between md:col-span-2">
          <div>
            <Label htmlFor="isActive">Activo</Label>
            <p className="text-[10px] text-muted-foreground">
              Los agentes inactivos no aparecen en los selectores de generación.
            </p>
          </div>
          <Switch
            id="isActive"
            checked={form.isActive}
            onCheckedChange={(v) => setForm({ ...form, isActive: v })}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/agentes")}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={saving} className="min-w-[140px]">
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <Check className="h-4 w-4" />
          ) : null}
          {saving ? "Guardando…" : saved ? "Guardado" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
