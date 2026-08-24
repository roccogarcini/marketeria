import { prisma } from "@/lib/prisma";

/**
 * Corte por presupuesto mensual de IA.
 *
 * `budget_usd_monthly` (AppSetting) existía desde el principio, pero solo se
 * leía en /admin/consumo para pintar un porcentaje y una barra roja: ninguna
 * llamada al LLM lo comprobaba. Se podía gastar 10x el tope sin que nada lo
 * impidiera y el aviso solo se veía si alguien entraba a mirar la página.
 *
 * Aquí está la comprobación real, que usan `execute()` y `trackExecution()`
 * (router.ts) antes de llamar a ningún proveedor.
 *
 * Decisiones:
 *  - El acumulado se calcula con un AGREGADO en BD (groupBy + SUM sobre
 *    AIExecution del mes natural) y las tarifas de ModelPrice. Nunca se traen
 *    las filas de ejecuciones.
 *  - SIN tope configurado (o tope 0) NO se corta nada. Es el estado por
 *    defecto de la app: quien no ha puesto tope no quiere que le paremos el
 *    trabajo. La tarjeta de /admin/consumo lo dice explícitamente.
 *  - Los modelos SIN tarifa en ModelPrice cuentan como 0 $: el gasto conocido
 *    infraestima el real. Se señala con `hasUnpricedModels` y el mensaje de
 *    bloqueo lo menciona, para que el operador sepa que el número va corto.
 *  - Si la propia comprobación falla (BD caída, etc.) se deja pasar la llamada
 *    (fail-open) y se loguea: un fallo de la vigilancia no debe dejar la app
 *    sin IA. El riesgo económico de un rato sin tope es menor que el de una
 *    app parada por un error de infraestructura.
 */

export const BUDGET_SETTING_KEY = "budget_usd_monthly";

/** Se lanza cuando una llamada se bloquea por haber superado el tope del mes. */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export type BudgetStatus = {
  /** Tope mensual en $ o null si no hay tope (no se corta nada). */
  budgetUsd: number | null;
  /** Gasto CONOCIDO del mes natural en $ (los modelos sin tarifa cuentan 0). */
  spentUsd: number;
  /** Primer día del mes natural en curso. */
  monthStart: Date;
  /** Hubo tokens de modelos sin tarifa: `spentUsd` se queda corto. */
  hasUnpricedModels: boolean;
  /** Hay tope y el gasto conocido ya lo alcanza o lo supera. */
  exceeded: boolean;
};

function monthStartOf(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Lee el tope de AppSetting. null = sin tope (también con 0 o valor inválido). */
async function readBudgetUsd(): Promise<number | null> {
  const setting = await prisma.appSetting.findUnique({ where: { key: BUDGET_SETTING_KEY } });
  const n = Number(setting?.value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Estado del presupuesto del mes natural en curso. Si no hay tope se ahorra
 * el agregado del gasto: no hay nada que comparar.
 */
export async function getMonthlyBudgetStatus(now: Date = new Date()): Promise<BudgetStatus> {
  const monthStart = monthStartOf(now);
  const budgetUsd = await readBudgetUsd();
  if (budgetUsd === null) {
    return {
      budgetUsd: null,
      spentUsd: 0,
      monthStart,
      hasUnpricedModels: false,
      exceeded: false,
    };
  }

  const [prices, rows] = await Promise.all([
    prisma.modelPrice.findMany({
      select: { modelId: true, inputPer1M: true, outputPer1M: true },
    }),
    // Agregado en BD: una fila por modelo con la suma de tokens del mes.
    prisma.aIExecution.groupBy({
      by: ["modelUsed"],
      where: { createdAt: { gte: monthStart } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);

  const priceMap = new Map(prices.map((p) => [p.modelId, p]));
  let spentUsd = 0;
  let hasUnpricedModels = false;
  for (const r of rows) {
    const inTok = r._sum.inputTokens ?? 0;
    const outTok = r._sum.outputTokens ?? 0;
    if (inTok === 0 && outTok === 0) continue;
    const price = r.modelUsed ? priceMap.get(r.modelUsed) : undefined;
    if (!price) {
      hasUnpricedModels = true;
      continue;
    }
    spentUsd += (inTok / 1_000_000) * price.inputPer1M + (outTok / 1_000_000) * price.outputPer1M;
  }

  return {
    budgetUsd,
    spentUsd,
    monthStart,
    hasUnpricedModels,
    exceeded: spentUsd >= budgetUsd,
  };
}

const NF_USD = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Mensaje de bloqueo. Dice el número, el tope y qué hacer para desbloquear. */
export function budgetBlockMessage(status: BudgetStatus): string {
  const mes = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(
    status.monthStart,
  );
  return (
    `Presupuesto mensual de IA superado: ${NF_USD.format(status.spentUsd)} $ gastados ` +
    `de un tope de ${NF_USD.format(status.budgetUsd ?? 0)} $ en ${mes}. ` +
    `La llamada NO se ha ejecutado. Sube el tope (o ponlo a 0 para quitarlo) en /admin/consumo.` +
    (status.hasUnpricedModels
      ? " Aviso: hay modelos sin tarifa configurada, así que el gasto real es aún mayor."
      : "")
  );
}

/**
 * Comprobación previa a cualquier llamada al LLM. Devuelve el mensaje de
 * bloqueo si NO se puede ejecutar, o null si se puede.
 *
 * Fail-open deliberado: si la comprobación revienta, se deja pasar la llamada.
 */
export async function budgetBlockReason(): Promise<string | null> {
  try {
    const status = await getMonthlyBudgetStatus();
    if (!status.exceeded) return null;
    return budgetBlockMessage(status);
  } catch (err) {
    console.error(
      "[budget] no se pudo comprobar el presupuesto mensual; se deja pasar la llamada:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
