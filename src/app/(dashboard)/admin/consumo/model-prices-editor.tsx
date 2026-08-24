"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, DownloadCloud, Save, Sparkles } from "lucide-react";

type Price = {
  id: string;
  modelId: string;
  inputPer1M: number;
  outputPer1M: number;
  currency: string;
  source: string; // "manual" | "auto"
};

export function ModelPricesEditor({
  initial,
  detected = [],
}: {
  initial: Price[];
  detected?: string[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ modelId: "", inputPer1M: "", outputPer1M: "" });
  const inputPriceRef = useRef<HTMLInputElement>(null);

  // Rellena el formulario con un modelId detectado y deja al admin poner el precio.
  function prefillModel(modelId: string) {
    setForm({ modelId, inputPer1M: "", outputPer1M: "" });
    // Enfoca el precio de entrada tras el re-render.
    requestAnimationFrame(() => inputPriceRef.current?.focus());
  }

  async function upsert(body: {
    modelId: string;
    inputPer1M: number;
    outputPer1M: number;
  }) {
    setError(null);
    const res = await fetch("/api/admin/model-prices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "Error guardando la tarifa");
      return false;
    }
    return true;
  }

  async function addPrice(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    const ok = await upsert({
      modelId: form.modelId.trim(),
      inputPer1M: Number(form.inputPer1M),
      outputPer1M: Number(form.outputPer1M),
    });
    setBusy(null);
    if (ok) {
      setForm({ modelId: "", inputPer1M: "", outputPer1M: "" });
      startTransition(() => router.refresh());
    }
  }

  async function saveRow(p: Price, input: number, output: number) {
    setBusy(p.id);
    const ok = await upsert({ modelId: p.modelId, inputPer1M: input, outputPer1M: output });
    setBusy(null);
    if (ok) startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    setBusy(id);
    await fetch(`/api/admin/model-prices/${id}`, { method: "DELETE" });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  async function loadDefaults() {
    setBusy("defaults");
    await fetch("/api/admin/model-prices", { method: "PUT" });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Tarifas por modelo ($/1M tokens)
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadDefaults} disabled={busy === "defaults"}>
            {busy === "defaults" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            Cargar tarifas por defecto
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Precio por millón de tokens de entrada y salida. Las tarifas con origen{" "}
        <span className="font-mono">auto</span> vienen del catálogo de OpenRouter
        (caja &quot;Tarifas automáticas&quot; de arriba); las que edites tú
        quedan como <span className="font-mono">manual</span> y el refresco no
        las pisa. El<code className="mx-1">modelId</code>debe coincidir
        exactamente con el que aparece en la tabla &quot;Por modelo&quot; de
        arriba; los modelos que usas se detectan solos.
      </p>

      {/* Modelos detectados en uso que aún no tienen tarifa */}
      {detected.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground/90">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Modelos que estás usando sin tarifa
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Detectados en tus ejecuciones reales. Pulsa uno para ponerle precio.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {detected.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => prefillModel(m)}
                className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-background/60 px-3 py-1 font-mono text-xs hover:bg-primary/10"
              >
                <Plus className="h-3 w-3" />
                {m}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Modelo</th>
              <th className="px-3 py-2 text-left">Origen</th>
              <th className="px-3 py-2 text-right">Entrada /1M</th>
              <th className="px-3 py-2 text-right">Salida /1M</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  Sin tarifas. Añade una, pulsa &quot;Refrescar precios ahora&quot; o
                  &quot;Cargar tarifas por defecto&quot;.
                </td>
              </tr>
            )}
            {initial.map((p) => (
              <PriceRow key={p.id} price={p} busy={busy === p.id} onSave={saveRow} onRemove={remove} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Añadir tarifa */}
      <form onSubmit={addPrice} className="glass-card grid gap-3 p-4 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="mp-model">modelId</Label>
          <Input
            id="mp-model"
            required
            value={form.modelId}
            onChange={(e) => setForm({ ...form, modelId: e.target.value })}
            placeholder="p. ej. gpt-4o-mini"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="mp-in">Entrada /1M</Label>
          <Input
            id="mp-in"
            ref={inputPriceRef}
            type="number"
            step="0.01"
            required
            value={form.inputPer1M}
            onChange={(e) => setForm({ ...form, inputPer1M: e.target.value })}
            placeholder="0.15"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="mp-out">Salida /1M</Label>
          <Input
            id="mp-out"
            type="number"
            step="0.01"
            required
            value={form.outputPer1M}
            onChange={(e) => setForm({ ...form, outputPer1M: e.target.value })}
            placeholder="0.60"
          />
        </div>
        <div className="md:col-span-4">
          <Button type="submit" disabled={busy === "add"} size="sm">
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Añadir / actualizar
          </Button>
        </div>
      </form>
    </section>
  );
}

function PriceRow({
  price,
  busy,
  onSave,
  onRemove,
}: {
  price: Price;
  busy: boolean;
  onSave: (p: Price, input: number, output: number) => void;
  onRemove: (id: string) => void;
}) {
  const [input, setInput] = useState(String(price.inputPer1M));
  const [output, setOutput] = useState(String(price.outputPer1M));
  const dirty = Number(input) !== price.inputPer1M || Number(output) !== price.outputPer1M;

  return (
    <tr className="border-t border-border/40">
      <td className="px-3 py-2 font-mono text-xs">{price.modelId}</td>
      <td className="px-3 py-2">
        {price.source === "auto" ? (
          <span
            className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-foreground/80"
            title="Tarifa del catálogo de OpenRouter; se refresca sola cada 24 h"
          >
            auto
          </span>
        ) : (
          <span
            className="rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground"
            title="Override manual: el refresco automático no la pisa"
          >
            manual
          </span>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          step="0.01"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="ml-auto h-8 w-24 text-right"
        />
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          type="number"
          step="0.01"
          value={output}
          onChange={(e) => setOutput(e.target.value)}
          className="ml-auto h-8 w-24 text-right"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={busy || !dirty}
            onClick={() => onSave(price, Number(input), Number(output))}
            aria-label="Guardar"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={busy}
            onClick={() => onRemove(price.id)}
            aria-label="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </td>
    </tr>
  );
}
