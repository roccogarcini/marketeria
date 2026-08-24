"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Loader2, DownloadCloud } from "lucide-react";
import {
  MATERIAL_LABELS,
  type MaterialLevel,
} from "@/lib/research/material";

/**
 * Semáforo de materia prima de un hallazgo + botón "Enriquecer" (descarga el
 * contenido completo de la URL original). Se usa en la ficha del hallazgo y
 * en el detalle de la idea antes de producir.
 */
export function MaterialBadge({
  level,
  findingId,
  canEnrich,
}: {
  level: MaterialLevel;
  /** Si se pasa (junto a canEnrich), muestra el botón Enriquecer. */
  findingId?: string;
  canEnrich?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const info = MATERIAL_LABELS[level];
  const tone =
    level === "FULL"
      ? "border-emerald-500/40 bg-emerald-500/10"
      : level === "PARTIAL"
        ? "border-amber-500/40 bg-amber-500/10"
        : "border-destructive/40 bg-destructive/10";

  async function enrich() {
    if (!findingId) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/findings/${findingId}/enrich`, {
      method: "POST",
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg(data.error ?? "No se pudo enriquecer (¿paywall o página solo-JS?)");
      return;
    }
    setMsg(
      data.status === "enriched"
        ? `Contenido completo descargado (${Math.round((data.chars ?? 0) / 1000)}k caracteres).`
        : data.status === "already"
          ? "Este hallazgo ya tenía el contenido completo."
          : "El hallazgo no tiene URL de la que descargar contenido.",
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {info.emoji} {info.label}
        </span>
        {canEnrich && findingId && level !== "FULL" && (
          <Button
            size="sm"
            variant="outline"
            onClick={enrich}
            disabled={busy}
            className="h-7 gap-1.5 text-xs"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            Enriquecer
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{msg ?? info.hint}</p>
    </div>
  );
}
