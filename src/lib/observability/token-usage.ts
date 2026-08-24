import { prisma } from "@/lib/prisma";

/**
 * Agregación del consumo de tokens (desde AIExecution) por modelo y por
 * agente, con coste calculado a partir de la tarifa de cada modelo
 * (ModelPrice, en unidades por millón de tokens). El coste se computa por
 * combinación agente×modelo y se suma, porque un mismo agente puede haber
 * usado varios modelos (p. ej. tras un fallback de proveedor).
 */

/**
 * Precios por defecto sugeridos ($/1M tokens) de los modelos actuales de cada
 * proveedor. El admin los revisa/edita: las tarifas cambian y ninguna API las
 * expone, así que son orientativas (verificadas en jul-2026). Además del seed,
 * el editor detecta y ofrece los modelos que la app usa realmente.
 */
export const DEFAULT_MODEL_PRICES: Array<{
  modelId: string;
  inputPer1M: number;
  outputPer1M: number;
}> = [
  // OpenAI — familia GPT-5.4
  { modelId: "gpt-5.4", inputPer1M: 2.5, outputPer1M: 15 },
  { modelId: "gpt-5.4-mini", inputPer1M: 0.75, outputPer1M: 4.5 },
  { modelId: "gpt-5.4-nano", inputPer1M: 0.2, outputPer1M: 1.25 },
  // DeepSeek — V4
  { modelId: "deepseek-v4-flash", inputPer1M: 0.14, outputPer1M: 0.28 },
  { modelId: "deepseek-v4-pro", inputPer1M: 0.435, outputPer1M: 0.87 },
  // z.ai — GLM 5.2 (tarifa oficial estándar)
  { modelId: "glm-5.2", inputPer1M: 1.4, outputPer1M: 4.4 },
];

export type ModelUsageRow = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  executions: number;
  cost: number | null; // null = sin tarifa configurada
  currency: string | null;
};

export type AgentUsageRow = {
  agentId: string | null;
  agentName: string; // "Sin agente / sistema" para ejecuciones sin agente
  inputTokens: number;
  outputTokens: number;
  executions: number;
  cost: number | null;
  hasUnpricedModel: boolean;
};

export type UsageSummary = {
  from: Date;
  to: Date;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalExecutions: number;
  totalCost: number; // suma de los costes conocidos
  hasUnpricedModels: boolean;
  currency: string;
  byModel: ModelUsageRow[];
  byAgent: AgentUsageRow[];
};

function costOf(
  price: { inputPer1M: number; outputPer1M: number } | undefined,
  inTokens: number,
  outTokens: number,
): number | null {
  if (!price) return null;
  return (inTokens / 1_000_000) * price.inputPer1M + (outTokens / 1_000_000) * price.outputPer1M;
}

export type DailyCostRow = {
  day: string; // ISO date (YYYY-MM-DD)
  costs: Record<string, number>; // modelId → coste $ del día
  total: number; // suma de costes conocidos del día
};

export type DailyCostSeries = {
  rows: DailyCostRow[];
  models: string[]; // modelos con coste en el rango, de mayor a menor gasto
  hasUnpricedModels: boolean; // hubo tokens de modelos sin tarifa (coste incompleto)
};

/**
 * Modelos que realmente se han usado (valores distintos de AIExecution.modelUsed),
 * en toda la historia. Sirve para ofrecer al admin exactamente los modelos que
 * consume la app —en vez de una lista fija que se queda anticuada— para que solo
 * tenga que poner el precio. El precio en sí no se puede leer de la API del
 * proveedor (no exponen tarifas), así que se introduce a mano.
 */
export async function getUsedModels(): Promise<string[]> {
  const rows = await prisma.aIExecution.groupBy({
    by: ["modelUsed"],
    _count: { _all: true },
  });
  return rows
    .map((r) => r.modelUsed)
    .filter((m): m is string => Boolean(m && m.trim()))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Serie diaria de COSTE en $ por modelo (para la gráfica de consumo, apilada
 * por modelo). El coste se calcula con la tarifa de cada modelo (ModelPrice);
 * los tokens de modelos sin tarifa no pueden costearse y se señalan con
 * hasUnpricedModels para avisar en la UI de que la gráfica está incompleta.
 */
export async function getDailyCost(from: Date, to: Date): Promise<DailyCostSeries> {
  const [prices, rows] = await Promise.all([
    prisma.modelPrice.findMany(),
    prisma.$queryRaw<
      Array<{ day: Date; model: string | null; input: bigint | number; output: bigint | number }>
    >`
      SELECT date_trunc('day', "createdAt") AS day,
             "modelUsed" AS model,
             COALESCE(SUM("inputTokens"), 0) AS input,
             COALESCE(SUM("outputTokens"), 0) AS output
      FROM "AIExecution"
      WHERE "createdAt" >= ${from} AND "createdAt" <= ${to}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `,
  ]);

  const priceMap = new Map(prices.map((p) => [p.modelId, p]));
  const byDay = new Map<string, DailyCostRow>();
  const byModelTotal = new Map<string, number>();
  let hasUnpricedModels = false;

  for (const r of rows) {
    const inTok = Number(r.input);
    const outTok = Number(r.output);
    const price = r.model ? priceMap.get(r.model) : undefined;
    const cost = costOf(price, inTok, outTok);
    if (cost === null) {
      if (inTok > 0 || outTok > 0) hasUnpricedModels = true;
      continue;
    }
    if (cost <= 0) continue;
    const day = (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().slice(0, 10);
    const model = r.model ?? "(desconocido)";
    const acc = byDay.get(day) ?? { day, costs: {}, total: 0 };
    acc.costs[model] = (acc.costs[model] ?? 0) + cost;
    acc.total += cost;
    byDay.set(day, acc);
    byModelTotal.set(model, (byModelTotal.get(model) ?? 0) + cost);
  }

  return {
    rows: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    models: [...byModelTotal.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    hasUnpricedModels,
  };
}

export async function getTokenUsage(from: Date, to: Date): Promise<UsageSummary> {
  const where = { createdAt: { gte: from, lte: to } };

  const [prices, byModelRaw, byAgentModelRaw, agents] = await Promise.all([
    prisma.modelPrice.findMany(),
    prisma.aIExecution.groupBy({
      by: ["modelUsed"],
      where,
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
    prisma.aIExecution.groupBy({
      by: ["agentId", "modelUsed"],
      where,
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true },
    }),
    prisma.agent.findMany({ select: { id: true, name: true } }),
  ]);

  const priceMap = new Map(prices.map((p) => [p.modelId, p]));
  const currency = prices[0]?.currency ?? "USD";
  const agentName = new Map(agents.map((a) => [a.id, a.name]));

  // ── Por modelo ──────────────────────────────────────────────────────────
  const byModel: ModelUsageRow[] = byModelRaw
    .map((r) => {
      const modelId = r.modelUsed ?? "(desconocido)";
      const inputTokens = r._sum.inputTokens ?? 0;
      const outputTokens = r._sum.outputTokens ?? 0;
      const price = r.modelUsed ? priceMap.get(r.modelUsed) : undefined;
      return {
        modelId,
        inputTokens,
        outputTokens,
        executions: r._count._all,
        cost: costOf(price, inputTokens, outputTokens),
        currency: price?.currency ?? null,
      };
    })
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));

  // ── Por agente (sumando el coste de cada modelo que usó) ─────────────────
  const agentAcc = new Map<
    string,
    { agentId: string | null; input: number; output: number; exec: number; cost: number; unpriced: boolean }
  >();
  for (const r of byAgentModelRaw) {
    const key = r.agentId ?? "__none__";
    const acc =
      agentAcc.get(key) ??
      { agentId: r.agentId, input: 0, output: 0, exec: 0, cost: 0, unpriced: false };
    const inTok = r._sum.inputTokens ?? 0;
    const outTok = r._sum.outputTokens ?? 0;
    const price = r.modelUsed ? priceMap.get(r.modelUsed) : undefined;
    const c = costOf(price, inTok, outTok);
    acc.input += inTok;
    acc.output += outTok;
    acc.exec += r._count._all;
    if (c === null) acc.unpriced = true;
    else acc.cost += c;
    agentAcc.set(key, acc);
  }
  const byAgent: AgentUsageRow[] = [...agentAcc.values()]
    .map((a) => ({
      agentId: a.agentId,
      agentName: a.agentId ? (agentName.get(a.agentId) ?? "(agente borrado)") : "Sin agente / sistema",
      inputTokens: a.input,
      outputTokens: a.output,
      executions: a.exec,
      cost: a.unpriced && a.cost === 0 ? null : a.cost,
      hasUnpricedModel: a.unpriced,
    }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));

  const totalInputTokens = byModel.reduce((n, r) => n + r.inputTokens, 0);
  const totalOutputTokens = byModel.reduce((n, r) => n + r.outputTokens, 0);
  const totalExecutions = byModel.reduce((n, r) => n + r.executions, 0);
  const totalCost = byModel.reduce((n, r) => n + (r.cost ?? 0), 0);
  const hasUnpricedModels = byModel.some((r) => r.cost === null && (r.inputTokens > 0 || r.outputTokens > 0));

  return {
    from,
    to,
    totalInputTokens,
    totalOutputTokens,
    totalExecutions,
    totalCost,
    hasUnpricedModels,
    currency,
    byModel,
    byAgent,
  };
}
