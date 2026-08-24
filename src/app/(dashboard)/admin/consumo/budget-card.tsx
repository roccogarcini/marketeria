"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, Save, X } from "lucide-react";

/**
 * Tarjeta de presupuesto mensual de IA (mes natural):
 * gastado / presupuesto, % consumido y barra de progreso con aviso visual
 * al pasar el 80% (ámbar) y al superarlo (rojo). El tope se guarda en
 * AppSetting con la clave budget_usd_monthly (vía /api/admin/settings).
 *
 * El tope CORTA de verdad: superado, las llamadas al LLM se bloquean antes de
 * salir (src/lib/ai/budget.ts). Sin tope configurado no se corta nada, y la
 * tarjeta lo dice para que no se dé por supuesta una protección que no existe.
 */

const SETTING_KEY = "budget_usd_monthly";

const NF_USD = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
function fmtUsd(n: number): string {
  return NF_USD.format(n || 0) + " $";
}

export function BudgetCard({
  monthLabel,
  monthCost,
  budgetUsd,
}: {
  monthLabel: string; // p. ej. "julio de 2026"
  monthCost: number; // coste acumulado del mes natural ($)
  budgetUsd: number | null; // null = sin presupuesto configurado
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(budgetUsd != null ? String(budgetUsd) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) {
      setError("Introduce un importe válido en $ (0 = sin presupuesto).");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: SETTING_KEY, value: String(n), category: "ai" }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("No se pudo guardar el presupuesto.");
      return;
    }
    setEditing(false);
    startTransition(() => router.refresh());
  }

  const hasBudget = budgetUsd != null && budgetUsd > 0;
  const percent = hasBudget ? (monthCost / budgetUsd) * 100 : null;
  const exceeded = percent != null && percent >= 100;
  const warn = percent != null && percent >= 80 && !exceeded;

  return (
    <section
      className={
        "glass-card p-4 " +
        (exceeded
          ? "border-2 border-destructive/50 bg-destructive/5"
          : warn
            ? "border-2 border-amber-500/50 bg-amber-500/5"
            : "")
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Presupuesto mensual · {monthLabel}
          </p>
          {hasBudget ? (
            <p className="mt-0.5 text-2xl font-medium tabular-nums">
              {fmtUsd(monthCost)}{" "}
              <span className="text-base text-muted-foreground">/ {fmtUsd(budgetUsd)}</span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm text-muted-foreground">
              Sin presupuesto configurado: el gasto no tiene freno. Ponle un tope y las
              llamadas al LLM se bloquearán al superarlo.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {percent != null && (
            <span
              className={
                "text-2xl font-semibold tabular-nums " +
                (exceeded ? "text-destructive" : warn ? "text-amber-500" : "text-foreground/80")
              }
            >
              {NF_USD.format(percent)}%
            </span>
          )}
          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              {hasBudget ? "Editar" : "Configurar"}
            </Button>
          )}
        </div>
      </div>

      {hasBudget && (
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted/60">
          <div
            className={
              "h-full transition-all " +
              (exceeded ? "bg-destructive" : warn ? "bg-amber-500" : "bg-primary")
            }
            style={{ width: `${Math.min(100, percent ?? 0)}%` }}
          />
        </div>
      )}

      {exceeded && (
        <p className="mt-2 text-xs font-medium text-destructive">
          Presupuesto del mes superado: las llamadas al LLM están BLOQUEADAS hasta que subas
          el tope, lo pongas a 0 o empiece el mes siguiente.
        </p>
      )}
      {warn && (
        <p className="mt-2 text-xs font-medium text-amber-500">
          Has pasado el 80% del presupuesto del mes. Al 100% se bloquean las llamadas.
        </p>
      )}

      {editing && (
        <form onSubmit={save} className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="p. ej. 50"
            className="h-8 w-32 text-right"
            autoFocus
          />
          <span className="text-sm text-muted-foreground">$/mes</span>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Guardar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" />
            Cancelar
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </form>
      )}
    </section>
  );
}
