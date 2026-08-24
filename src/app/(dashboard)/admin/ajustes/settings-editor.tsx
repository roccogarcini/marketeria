"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronDown, Loader2 } from "lucide-react";

type Setting = {
  key: string;
  value: string;
  category: string;
  updatedAt: string;
};

/**
 * Ajustes avanzados de la tabla AppSetting, explicados clave a clave:
 *  - Las claves con pantalla propia (Google, SMTP, copias, presupuesto IA,
 *    registro del refresco de tarifas) se filtran en page.tsx y se editan
 *    en su propia sección.
 *  - El resto vive plegado bajo "Avanzado", con nombre y explicación en
 *    claro de cada clave conocida, y aviso para las desconocidas.
 */
const KNOWN_SETTINGS: Record<string, { label: string; description: string }> = {
  automations_enabled: {
    label: "Automatizaciones activas",
    description:
      "Interruptor global reservado para pausar todas las automatizaciones programadas. " +
      "A día de hoy el código no lo consulta: cambiarlo no tiene efecto. Valores: true / false.",
  },
  findings_retention_days: {
    label: "Retención de hallazgos (días)",
    description:
      "Días que se conservarían los hallazgos de investigación antes de limpiarse. " +
      "Reservado: la limpieza automática aún no está implementada, así que este valor no se aplica.",
  },
};

export function SettingsEditor({ initial }: { initial: Setting[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(initial.map((s) => [s.key, s.value])),
  );
  const [error, setError] = useState<string | null>(null);

  async function save(key: string) {
    setError(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value: drafts[key] }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="glass-card flex flex-col gap-3 p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
      >
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Avanzado
          </h2>
          <p className="text-xs text-muted-foreground">
            Ajustes internos guardados como clave→valor. Normalmente no hace
            falta tocarlos: todo lo importante se configura en sus propias
            pantallas (Google y SMTP arriba, presupuesto en Consumo IA, copias
            en Copias de seguridad).
          </p>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border/40 pt-3">
          {error && (
            <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          {initial.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No hay ajustes avanzados pendientes: todo se gestiona desde sus
              secciones.
            </p>
          )}

          {initial.map((s) => {
            const known = KNOWN_SETTINGS[s.key];
            return (
              <div key={s.key} className="flex flex-col gap-2 rounded-lg border border-border/40 p-3">
                <Label htmlFor={`s-${s.key}`} className="flex items-center justify-between">
                  <span>{known?.label ?? s.key}</span>
                  <span className="font-mono text-[10px] font-normal text-muted-foreground">{s.key}</span>
                </Label>
                <p className="text-xs text-muted-foreground">
                  {known?.description ??
                    "Clave interna creada por el sistema. Si no sabes qué es, no la cambies."}
                </p>
                <div className="flex gap-2">
                  <Input
                    id={`s-${s.key}`}
                    value={drafts[s.key] ?? ""}
                    onChange={(e) => setDrafts({ ...drafts, [s.key]: e.target.value })}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={() => save(s.key)}
                    disabled={pending || drafts[s.key] === s.value}
                  >
                    {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
