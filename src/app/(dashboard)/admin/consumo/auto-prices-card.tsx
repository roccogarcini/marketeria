"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";

/**
 * Caja "Tarifas automáticas": estado del refresco
 * diario de precios desde el catálogo público de OpenRouter + refresco
 * manual inmediato. El scheduler corre solo cada 24 h (lib/ai/pricing-scheduler);
 * aquí solo se muestra y se fuerza a demanda.
 */
export function AutoPricesCard({
  pricedModels,
  autoCount,
  manualCount,
  lastRefreshAt,
}: {
  pricedModels: number;
  autoCount: number;
  manualCount: number;
  lastRefreshAt: string | null;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refreshNow() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/model-prices/refresh", { method: "POST" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "No se pudo refrescar el catálogo de precios");
    }
    setBusy(false);
    startTransition(() => router.refresh());
  }

  return (
    <section className="glass-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Tarifas automáticas
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
            Precios por modelo desde el catálogo público de OpenRouter. Se
            refrescan solos cada 24 h. Tus precios manuales siguen teniendo
            prioridad.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refreshNow} disabled={busy}>
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refrescar ahora
        </Button>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <p>
          <span className="text-muted-foreground">Modelos con tarifa:</span>{" "}
          <span className="font-medium tabular-nums">{pricedModels}</span>
          {pricedModels > 0 && (
            <span className="text-xs text-muted-foreground">
              {" "}
              ({autoCount} auto · {manualCount} manuales)
            </span>
          )}
        </p>
        <p>
          <span className="text-muted-foreground">Último refresco:</span>{" "}
          <span className="font-medium">
            {lastRefreshAt
              ? new Date(lastRefreshAt).toLocaleString("es-ES", {
                  dateStyle: "short",
                  timeStyle: "short",
                })
              : "todavía no"}
          </span>
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </section>
  );
}
