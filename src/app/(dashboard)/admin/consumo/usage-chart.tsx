import type { DailyCostSeries } from "@/lib/observability/token-usage";

/**
 * "Coste del LLM por día ($)":
 * barras apiladas por modelo con el COSTE en dólares (no tokens), y todos los
 * números en formato es-ES (punto de miles, COMA decimal). SVG puro (sin
 * dependencias), responsive por viewBox, tooltip nativo por barra (<title>).
 *
 * Clave: el eje X cubre TODO el rango pedido (from→to), incluidos los días sin
 * consumo, para que al cambiar 7/30/90 días la gráfica cambie de verdad. En
 * rangos largos se agrupa por semanas para que siga siendo legible.
 */

// Paleta CVD-safe para los segmentos por modelo (se recorre en orden de gasto).
const MODEL_PALETTE = [
  "#3b82f6", // azul
  "#f59e0b", // ámbar
  "#10b981", // esmeralda
  "#8b5cf6", // violeta
  "#ef4444", // rojo
  "#06b6d4", // cian
  "#ec4899", // rosa
  "#84cc16", // lima
];
// A partir de aquí, el resto de modelos se agrupa como "otros".
const MAX_MODELS = MODEL_PALETTE.length - 1;
const C_OTHERS = "#9ca3af";
const OTHERS_KEY = "otros";

// A partir de este nº de días, agrupamos por semanas (evita cientos de barras).
const MAX_DAILY_BARS = 92;

// Formato es-ES: punto de miles, coma decimal. Montos <1$ con 4 decimales
// (los costes por día suelen ser céntimos), el resto con 2.
const NF_USD_BIG = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NF_USD_SMALL = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
function fmtUsd(n: number): string {
  const v = n || 0;
  return (v < 1 && v > 0 ? NF_USD_SMALL.format(v) : NF_USD_BIG.format(v)) + " $";
}

type Bar = { key: string; date: string; costs: Record<string, number>; total: number };

/** Días ISO (YYYY-MM-DD) de from a to inclusive, en UTC para evitar saltos DST. */
function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  const start = Date.parse(from + "T00:00:00Z");
  const end = Date.parse(to + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end) || start > end) return out;
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

/** Colapsa los modelos menos costosos en "otros" para no agotar la paleta. */
function seriesKeys(models: string[]): string[] {
  if (models.length <= MODEL_PALETTE.length) return models;
  return [...models.slice(0, MAX_MODELS), OTHERS_KEY];
}

function collapseCosts(costs: Record<string, number>, top: Set<string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [model, cost] of Object.entries(costs)) {
    const key = top.has(model) ? model : OTHERS_KEY;
    out[key] = (out[key] ?? 0) + cost;
  }
  return out;
}

/** Barras del rango: una por día, o por semana (cubos de 7) si el rango es largo. */
function buildBars(
  data: DailyCostSeries["rows"],
  from: string,
  to: string,
  top: Set<string>,
): { bars: Bar[]; weekly: boolean } {
  const byDay = new Map(data.map((d) => [d.day, d]));
  const days = eachDay(from, to);
  if (days.length === 0) return { bars: [], weekly: false };

  if (days.length <= MAX_DAILY_BARS) {
    return {
      weekly: false,
      bars: days.map((d) => {
        const row = byDay.get(d);
        return {
          key: d,
          date: d,
          costs: row ? collapseCosts(row.costs, top) : {},
          total: row?.total ?? 0,
        };
      }),
    };
  }

  const bars: Bar[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const costs: Record<string, number> = {};
    let total = 0;
    for (const d of chunk) {
      const row = byDay.get(d);
      if (!row) continue;
      for (const [model, cost] of Object.entries(collapseCosts(row.costs, top))) {
        costs[model] = (costs[model] ?? 0) + cost;
      }
      total += row.total;
    }
    bars.push({ key: chunk[0], date: chunk[0], costs, total });
  }
  return { bars, weekly: true };
}

export function UsageChart({
  series,
  from,
  to,
}: {
  series: DailyCostSeries;
  from: string;
  to: string;
}) {
  // Sin ningún día con coste en el rango → mensaje, no lienzo vacío.
  if (series.rows.every((d) => d.total === 0)) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
        Sin coste en este rango{series.hasUnpricedModels ? " (hay consumo de modelos sin tarifa)" : ""}.
      </div>
    );
  }

  const keys = seriesKeys(series.models);
  const top = new Set(keys.filter((k) => k !== OTHERS_KEY));
  const color = new Map(keys.map((k, i) => [k, k === OTHERS_KEY ? C_OTHERS : MODEL_PALETTE[i % MODEL_PALETTE.length]]));

  const { bars, weekly } = buildBars(series.rows, from, to, top);
  if (bars.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
        Sin coste en este rango.
      </div>
    );
  }

  // Geometría del lienzo (coordenadas internas; el SVG escala por viewBox).
  const W = 760;
  const H = 240;
  const padL = 58;
  const padR = 14;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...bars.map((b) => b.total), 0.0001);
  const niceMax = niceCeil(max);

  const n = bars.length;
  const slot = plotW / n;
  const barW = Math.max(1.5, Math.min(38, slot * 0.62));

  const y = (v: number) => padT + plotH - (v / niceMax) * plotH;
  const gridVals = [0, niceMax / 2, niceMax];
  const step = Math.ceil(n / 8);

  return (
    <figure className="glass-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption className="text-sm font-medium">
          Coste del LLM {weekly ? "por semana" : "por día"} ($)
        </figcaption>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="text-[10px] uppercase tracking-widest">Apilado por modelo</span>
          {keys.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color.get(k) }} />
              <span className="font-mono">{k}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full min-w-[520px]"
          role="img"
          aria-label={`Gráfica de coste del LLM ${weekly ? "por semana" : "por día"} en dólares`}
        >
          {/* Rejilla + etiquetas Y (recesivas) */}
          {gridVals.map((v) => (
            <g key={v}>
              <line
                x1={padL}
                x2={W - padR}
                y1={y(v)}
                y2={y(v)}
                stroke="currentColor"
                className="text-border"
                strokeWidth={1}
                opacity={0.4}
              />
              <text
                x={padL - 8}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground"
                fontSize={11}
              >
                {fmtUsd(v)}
              </text>
            </g>
          ))}

          {/* Barras apiladas por modelo (orden estable: de mayor a menor gasto) */}
          {bars.map((d, i) => {
            const cx = padL + slot * i + slot / 2;
            const x = cx - barW / 2;
            const baseY = padT + plotH;
            const when = weekly ? `semana del ${formatDay(d.date)}` : formatDay(d.date);
            const detail = keys
              .filter((k) => (d.costs[k] ?? 0) > 0)
              .map((k) => `${k} ${fmtUsd(d.costs[k])}`)
              .join(", ");
            const label =
              d.total > 0 ? `${when} · ${fmtUsd(d.total)}${detail ? ` (${detail})` : ""}` : `${when} · sin coste`;
            let acc = 0;
            return (
              <g key={d.key}>
                <title>{label}</title>
                {keys.map((k) => {
                  const v = d.costs[k] ?? 0;
                  if (v <= 0) return null;
                  const h = (v / niceMax) * plotH;
                  const yTop = baseY - ((acc + v) / niceMax) * plotH;
                  acc += v;
                  return <rect key={k} x={x} y={yTop} width={barW} height={h} rx={2} fill={color.get(k)} />;
                })}
                {i % step === 0 && (
                  <text
                    x={cx}
                    y={H - padB + 16}
                    textAnchor="middle"
                    className="fill-muted-foreground"
                    fontSize={10}
                  >
                    {formatDay(d.date)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Eje base */}
          <line
            x1={padL}
            x2={W - padR}
            y1={padT + plotH}
            y2={padT + plotH}
            stroke="currentColor"
            className="text-border"
            strokeWidth={1}
          />
        </svg>
      </div>

      {series.hasUnpricedModels && (
        <p className="text-[10px] text-amber-500">
          Gráfica incompleta: hay consumo de modelos sin tarifa (ponles precio abajo o refresca el catálogo).
        </p>
      )}
    </figure>
  );
}

function formatDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

/** Redondea el tope del eje a un valor "bonito" (1/2/5 × 10^k). */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const f = n / base;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * base;
}
