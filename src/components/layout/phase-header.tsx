import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * PhaseHeader — cabecera unificada para las páginas de fase.
 *
 * Estructura:
 *   [Fase N · Nombre]                                    [Acciones]
 *   Subtítulo descriptivo corto.
 *   [ chip · chip · chip ]
 *
 * Elimina el ruido de múltiples títulos/sections por página: cada fase
 * muestra su identidad arriba con KPIs inline y UNA acción principal.
 */

export type PhaseStat = {
  label: string;
  value: string | number;
  accent?: boolean;
  icon?: LucideIcon;
};

export function PhaseHeader({
  phase,
  title,
  subtitle,
  stats,
  actions,
}: {
  phase: number;
  title: string;
  subtitle?: string;
  stats?: PhaseStat[];
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-col items-start justify-between gap-3 md:flex-row md:items-end">
        <div>
          <span className="eyebrow">Fase {phase}</span>
          <h1 className="display-md mt-1.5">{title}</h1>
          {subtitle && (
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {stats && stats.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <span
                key={`${s.label}-${i}`}
                className={`inline-flex items-center gap-1.5 ${
                  s.accent ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                <span
                  className={`font-semibold ${s.accent ? "text-foreground" : "text-foreground"}`}
                >
                  {s.value}
                </span>
                <span>{s.label}</span>
              </span>
            );
          })}
        </div>
      )}
    </header>
  );
}
