import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getTokenUsage, getDailyCost, getUsedModels } from "@/lib/observability/token-usage";
import { getPriceRefreshStatus } from "@/lib/ai/pricing";
import { ModelPricesEditor } from "./model-prices-editor";
import { UsageChart } from "./usage-chart";
import { BudgetCard } from "./budget-card";
import { AutoPricesCard } from "./auto-prices-card";

export const dynamic = "force-dynamic";

const RANGES: Record<string, { label: string; days: number | null }> = {
  "7": { label: "7 días", days: 7 },
  "30": { label: "30 días", days: 30 },
  "90": { label: "90 días", days: 90 },
  all: { label: "Todo", days: null },
};

const BUDGET_SETTING_KEY = "budget_usd_monthly";

function fmtInt(n: number): string {
  return new Intl.NumberFormat("es-ES").format(n);
}
// Dinero en es-ES: punto de miles, COMA decimal. Montos <1 con 4 decimales.
const NF_MONEY_BIG = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NF_MONEY_SMALL = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});
function fmtMoney(n: number, currency: string): string {
  const formatted = n < 1 && n > 0 ? NF_MONEY_SMALL.format(n) : NF_MONEY_BIG.format(n);
  return `${formatted} ${currency === "USD" ? "$" : currency}`;
}

export default async function ConsumoPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range = "30" } = await searchParams;
  const sel = RANGES[range] ?? RANGES["30"];
  const to = new Date();
  const from = sel.days
    ? new Date(Date.now() - sel.days * 24 * 3600 * 1000)
    : new Date(0);

  // Presupuesto: siempre sobre el MES NATURAL, independiente del rango elegido.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLabel = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(now);

  const [usage, dailyCost, prices, usedModels, monthUsage, budgetSetting, refreshStatus] =
    await Promise.all([
      getTokenUsage(from, to),
      getDailyCost(from, to),
      prisma.modelPrice.findMany({ orderBy: { modelId: "asc" } }),
      getUsedModels(),
      getTokenUsage(monthStart, now),
      prisma.appSetting.findUnique({ where: { key: BUDGET_SETTING_KEY } }),
      getPriceRefreshStatus(),
    ]);

  const budgetUsd = (() => {
    const n = Number(budgetSetting?.value);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  // Modelos que la app realmente consume pero que aún no tienen tarifa: se
  // ofrecen en el editor para ponerles precio de un clic (los IDs se detectan
  // solos; la tarifa hay que introducirla porque el proveedor no la expone).
  const priced = new Set(prices.map((p) => p.modelId));
  const detectedModels = usedModels.filter((m) => !priced.has(m));

  // Ventana de la gráfica (días ISO). En "Todo" no arrancamos en 1970: usamos
  // el primer día con datos. Así el eje X refleja el rango elegido.
  const toDay = to.toISOString().slice(0, 10);
  const chartFrom = sel.days ? from.toISOString().slice(0, 10) : (dailyCost.rows[0]?.day ?? toDay);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Consumo IA</h1>
        <p className="text-sm text-muted-foreground">
          Tokens y coste estimado por modelo y por agente. El coste se calcula
          con la tarifa de cada modelo (editable abajo).
        </p>
      </header>

      {/* Rango */}
      <div className="flex flex-wrap items-center gap-2">
        {Object.entries(RANGES).map(([key, r]) => (
          <Link
            key={key}
            href={`/admin/consumo?range=${key}`}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              (range in RANGES ? range : "30") === key
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-border/60 text-muted-foreground hover:bg-accent/40"
            }`}
          >
            {r.label}
          </Link>
        ))}
      </div>

      {/* Totales */}
      <section className="grid gap-3 md:grid-cols-4">
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Tokens entrada</p>
          <p className="text-2xl font-medium tabular-nums">{fmtInt(usage.totalInputTokens)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Tokens salida</p>
          <p className="text-2xl font-medium tabular-nums">{fmtInt(usage.totalOutputTokens)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Coste estimado</p>
          <p className="text-2xl font-medium tabular-nums">
            {fmtMoney(usage.totalCost, usage.currency)}
          </p>
          {usage.hasUnpricedModels && (
            <p className="mt-1 text-[10px] text-amber-500">
              Incompleto: hay modelos sin tarifa
            </p>
          )}
        </div>
        <div className="glass-card p-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Ejecuciones</p>
          <p className="text-2xl font-medium tabular-nums">{fmtInt(usage.totalExecutions)}</p>
        </div>
      </section>

      {/* Presupuesto mensual (mes natural, independiente del rango) */}
      <BudgetCard monthLabel={monthLabel} monthCost={monthUsage.totalCost} budgetUsd={budgetUsd} />

      {/* Gráfica de coste en el rango seleccionado */}
      <UsageChart series={dailyCost} from={chartFrom} to={toDay} />

      {/* Por agente */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Por agente
        </h2>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Agente</th>
                <th className="px-3 py-2 text-right">Tokens in</th>
                <th className="px-3 py-2 text-right">Tokens out</th>
                <th className="px-3 py-2 text-right">Ejecuciones</th>
                <th className="px-3 py-2 text-right">Coste</th>
              </tr>
            </thead>
            <tbody>
              {usage.byAgent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Sin ejecuciones en este rango.
                  </td>
                </tr>
              )}
              {usage.byAgent.map((a) => (
                <tr key={a.agentId ?? "none"} className="border-t border-border/40">
                  <td className="px-3 py-2 font-medium">{a.agentName}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.inputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(a.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtInt(a.executions)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {a.cost === null ? (
                      <span className="text-amber-500" title="Algún modelo sin tarifa">
                        {a.hasUnpricedModel ? "sin tarifa" : "—"}
                      </span>
                    ) : (
                      <>
                        {fmtMoney(a.cost, usage.currency)}
                        {a.hasUnpricedModel && <span className="text-amber-500"> *</span>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Por modelo */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Por modelo
        </h2>
        <div className="glass-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Modelo</th>
                <th className="px-3 py-2 text-right">Tokens in</th>
                <th className="px-3 py-2 text-right">Tokens out</th>
                <th className="px-3 py-2 text-right">Ejecuciones</th>
                <th className="px-3 py-2 text-right">Coste</th>
              </tr>
            </thead>
            <tbody>
              {usage.byModel.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                    Sin ejecuciones en este rango.
                  </td>
                </tr>
              )}
              {usage.byModel.map((m) => (
                <tr key={m.modelId} className="border-t border-border/40">
                  <td className="px-3 py-2 font-mono text-xs">{m.modelId}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(m.inputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInt(m.outputTokens)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {fmtInt(m.executions)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {m.cost === null ? (
                      <span className="text-amber-500">sin tarifa</span>
                    ) : (
                      fmtMoney(m.cost, usage.currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tarifas automáticas (catálogo OpenRouter, refresco diario) */}
      <AutoPricesCard
        pricedModels={prices.length}
        autoCount={prices.filter((p) => p.source === "auto").length}
        manualCount={prices.filter((p) => p.source !== "auto").length}
        lastRefreshAt={refreshStatus.lastRunAt}
      />

      {/* Editor de tarifas */}
      <ModelPricesEditor
        initial={prices.map((p) => ({
          id: p.id,
          modelId: p.modelId,
          inputPer1M: p.inputPer1M,
          outputPer1M: p.outputPer1M,
          currency: p.currency,
          source: p.source,
        }))}
        detected={detectedModels}
      />
    </div>
  );
}
