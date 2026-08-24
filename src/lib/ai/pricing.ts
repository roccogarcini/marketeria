import { prisma } from "@/lib/prisma";
import { getUsedModels } from "@/lib/observability/token-usage";
import { fetchWithRetry } from "@/lib/net/retry";

/**
 * Refresco automático de tarifas por modelo desde el catálogo público de
 * OpenRouter (GET /models, sin clave): los proveedores no exponen sus precios
 * por API, pero OpenRouter publica los precios reales por modelo de todos
 * ellos (GPT, Claude, Gemini, DeepSeek,
 * GLM…), en USD por token. Matching tolerante de nombres:
 * "gpt-4o-mini" ↔ "openai/gpt-4o-mini", "claude-sonnet-4-5" ↔
 * "anthropic/claude-sonnet-4.5".
 *
 * El destino es la tabla ModelPrice — la misma que usa el cálculo de coste de
 * Consumo IA — con la regla de oro: las filas con source="manual" NUNCA se
 * pisan; solo se
 * crean/actualizan filas "auto".
 */

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const STATUS_SETTING_KEY = "ai.priceAutoRefresh";

export interface ModelPriceUsd {
  inPer1M: number;
  outPer1M: number;
}

export interface RefreshResult {
  ranAt: string; // ISO
  catalogModels: number; // modelos con precio en el catálogo descargado
  created: string[]; // tarifas nuevas (source=auto)
  updated: string[]; // tarifas auto actualizadas con precio distinto
  skippedManual: string[]; // modelos con override manual (no se tocan)
  unmatched: string[]; // modelos usados sin correspondencia en el catálogo
}

export interface RefreshStatus {
  lastRunAt: string | null;
  lastResult: RefreshResult | null;
}

/** Clave tolerante: minúsculas y solo alfanuméricos ("claude-sonnet-4.5" → "claudesonnet45"). */
export function normalizeModelKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchCatalog(): Promise<Record<string, ModelPriceUsd>> {
  const res = await fetchWithRetry(
    OPENROUTER_MODELS_URL,
    { signal: AbortSignal.timeout(10_000) },
    { label: "OpenRouter /models" },
  );
  if (!res.ok) throw new Error(`OpenRouter /models respondió ${res.status}`);
  const json = (await res.json()) as {
    data?: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }>;
  };
  const prices: Record<string, ModelPriceUsd> = {};
  for (const m of json.data ?? []) {
    if (!m.id) continue;
    // OpenRouter publica USD por token; se guarda USD por 1M de tokens.
    const inPer1M = (Number(m.pricing?.prompt) || 0) * 1_000_000;
    const outPer1M = (Number(m.pricing?.completion) || 0) * 1_000_000;
    if (inPer1M <= 0 && outPer1M <= 0) continue; // variantes gratuitas/sin precio no aportan
    prices[m.id] = { inPer1M, outPer1M };
  }
  return prices;
}

/** Índices exacto + normalizado (+ sufijo tras "proveedor/") para el matching tolerante. */
function buildIndexes(prices: Record<string, ModelPriceUsd>): {
  byExact: Map<string, ModelPriceUsd>;
  byNorm: Map<string, ModelPriceUsd>;
} {
  const byExact = new Map<string, ModelPriceUsd>();
  const byNorm = new Map<string, ModelPriceUsd>();
  for (const [id, p] of Object.entries(prices)) {
    byExact.set(id, p);
    const norm = normalizeModelKey(id);
    if (!byNorm.has(norm)) byNorm.set(norm, p);
    // También por el sufijo tras "proveedor/" para casar ids de APIs directas.
    const slash = id.indexOf("/");
    if (slash > 0) {
      const suffix = normalizeModelKey(id.slice(slash + 1));
      if (!byNorm.has(suffix)) byNorm.set(suffix, p);
    }
  }
  return { byExact, byNorm };
}

/**
 * Refresca ModelPrice desde OpenRouter:
 *  - candidatos = modelos realmente usados (AIExecution.modelUsed) + filas
 *    "auto" ya existentes (para mantenerlas al día aunque dejen de usarse).
 *  - las filas "manual" no se tocan jamás (override del admin).
 *  - guarda el resultado en AppSetting para diagnóstico en el panel.
 */
export async function refreshModelPrices(): Promise<RefreshResult> {
  const catalog = await fetchCatalog();
  const { byExact, byNorm } = buildIndexes(catalog);

  const [usedModels, existing] = await Promise.all([
    getUsedModels(),
    prisma.modelPrice.findMany(),
  ]);
  const existingById = new Map(existing.map((p) => [p.modelId, p]));

  const candidates = new Set<string>(usedModels);
  for (const p of existing) if (p.source === "auto") candidates.add(p.modelId);

  const result: RefreshResult = {
    ranAt: new Date().toISOString(),
    catalogModels: byExact.size,
    created: [],
    updated: [],
    skippedManual: [],
    unmatched: [],
  };

  for (const modelId of candidates) {
    const current = existingById.get(modelId);
    if (current?.source === "manual") {
      result.skippedManual.push(modelId);
      continue;
    }
    const usd = byExact.get(modelId) ?? byNorm.get(normalizeModelKey(modelId));
    if (!usd) {
      result.unmatched.push(modelId);
      continue;
    }
    if (!current) {
      await prisma.modelPrice.create({
        data: {
          modelId,
          inputPer1M: usd.inPer1M,
          outputPer1M: usd.outPer1M,
          currency: "USD",
          source: "auto",
        },
      });
      result.created.push(modelId);
    } else if (current.inputPer1M !== usd.inPer1M || current.outputPer1M !== usd.outPer1M) {
      await prisma.modelPrice.update({
        where: { modelId },
        data: { inputPer1M: usd.inPer1M, outputPer1M: usd.outPer1M, source: "auto" },
      });
      result.updated.push(modelId);
    }
  }

  await prisma.appSetting.upsert({
    where: { key: STATUS_SETTING_KEY },
    create: { key: STATUS_SETTING_KEY, value: JSON.stringify(result), category: "ai" },
    update: { value: JSON.stringify(result) },
  });

  return result;
}

/** Última ejecución del refresco (para el scheduler y el panel). */
export async function getPriceRefreshStatus(): Promise<RefreshStatus> {
  const row = await prisma.appSetting.findUnique({ where: { key: STATUS_SETTING_KEY } });
  if (!row) return { lastRunAt: null, lastResult: null };
  try {
    const parsed = JSON.parse(row.value) as RefreshResult;
    return { lastRunAt: parsed.ranAt ?? null, lastResult: parsed };
  } catch {
    return { lastRunAt: null, lastResult: null };
  }
}
