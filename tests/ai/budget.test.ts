import test, { before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakePrisma, type Row } from "../helpers/fake-prisma.ts";

/**
 * Tope de gasto mensual.
 *
 * `budget_usd_monthly` no es solo un indicador de /admin/consumo: se comprueba
 * ANTES de llamar al proveedor, tanto en `execute()` como en
 * `trackExecution()` (las búsquedas web nativas, que no pasan por execute).
 * Al alcanzarse el tope, la llamada se corta en vez de seguir gastando.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AI_API = pathToFileURL(path.join(ROOT, "src/lib/ai/api.ts")).href;

const db = createFakePrisma();
const calls = { runAPI: 0, tracked: 0 };

let execute: typeof import("@/lib/ai/router").execute;
let trackExecution: typeof import("@/lib/ai/router").trackExecution;
let runAIResearch: typeof import("@/lib/research/ai-research").runAIResearch;
let getMonthlyBudgetStatus: typeof import("@/lib/ai/budget").getMonthlyBudgetStatus;
let BudgetExceededError: typeof import("@/lib/ai/budget").BudgetExceededError;
let encrypt: typeof import("@/lib/crypto").encrypt;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  mock.module(AI_API, {
    namedExports: {
      runAPI: async () => {
        calls.runAPI++;
        return {
          output: "respuesta",
          model: "deepseek-chat",
          tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        };
      },
      openaiChatCreate: async () => {
        throw new Error("no usado en este test");
      },
      openaiCompatClientFor: () => {
        throw new Error("no usado en este test");
      },
      pingProvider: async () => undefined,
      listProviderModels: async () => [],
    },
  });
  ({ encrypt } = await import("@/lib/crypto"));
  ({ execute, trackExecution } = await import("@/lib/ai/router"));
  ({ getMonthlyBudgetStatus, BudgetExceededError } = await import("@/lib/ai/budget"));
  ({ runAIResearch } = await import("@/lib/research/ai-research"));
});

beforeEach(() => {
  db.reset();
  calls.runAPI = 0;
  calls.tracked = 0;
});

function seedProvider() {
  db.seed("lLMProvider", {
    userId: "user-1",
    providerType: "DEEPSEEK",
    displayName: "DeepSeek test",
    encryptedApiKey: encrypt("sk-test"),
    baseUrl: null,
    defaultModel: null,
    isActive: true,
    isDefaultResearch: false,
  });
}

function seedBudget(usd: string) {
  db.seed("appSetting", { key: "budget_usd_monthly", value: usd, category: "ai" });
}

/** Tarifa que hace fácil la cuenta: 1 $ por cada 1000 tokens de entrada. */
function seedPrice(modelId = "deepseek-chat") {
  db.seed("modelPrice", { modelId, inputPer1M: 1000, outputPer1M: 0, currency: "USD" });
}

/** Gasto ya consumido este mes: `inputTokens` a la tarifa de arriba = $/1000. */
function seedSpend(inputTokens: number, extra: Row = {}) {
  db.seed("aIExecution", {
    phase: "RESEARCH",
    agentId: null,
    executionMode: "API",
    modelUsed: "deepseek-chat",
    inputTokens,
    outputTokens: 0,
    status: "SUCCESS",
    createdAt: new Date(),
    ...extra,
  });
}

const REQ = { phase: "RESEARCH", userPrompt: "hola" } as const;

test("sin tope configurado no se corta nada", async () => {
  seedProvider();
  seedPrice();
  seedSpend(999_000_000); // gasto enorme, pero no hay tope

  const r = await execute("user-1", REQ);

  assert.equal(r.status, "SUCCESS");
  assert.equal(calls.runAPI, 1);

  const status = await getMonthlyBudgetStatus();
  assert.equal(status.budgetUsd, null, "sin AppSetting el tope debe ser null");
  assert.equal(status.exceeded, false, "sin tope nunca se considera superado");
});

test("con gasto por debajo del tope la llamada se ejecuta", async () => {
  seedProvider();
  seedBudget("10");
  seedPrice();
  seedSpend(2_000); // 2 $ de 10 $

  const r = await execute("user-1", REQ);

  assert.equal(r.status, "SUCCESS");
  assert.equal(calls.runAPI, 1);
});

test("superado el tope, execute() NO llama al proveedor y devuelve un error claro", async () => {
  seedProvider();
  seedBudget("10");
  seedPrice();
  seedSpend(12_000); // 12 $ de 10 $

  const r = await execute("user-1", REQ);

  assert.equal(calls.runAPI, 0, "se llamó al proveedor pese a haber superado el tope");
  assert.equal(r.status, "ERROR");
  assert.match(String(r.error), /presupuesto/i);
  assert.match(String(r.error), /no se ha ejecutado/i);
  assert.equal(r.output, "");
});

test("la llamada bloqueada queda registrada en AIExecution (no es un fallo silencioso)", async () => {
  seedProvider();
  seedBudget("10");
  seedPrice();
  seedSpend(12_000);

  await execute("user-1", REQ);

  const blocked = db.rows("aIExecution").filter((e) => e.status === "ERROR");
  assert.equal(blocked.length, 1, "no dejó rastro del corte en AIExecution");
  assert.match(String(blocked[0].errorMessage), /presupuesto/i);
  assert.equal(blocked[0].inputTokens ?? null, null, "una llamada bloqueada no consume tokens");
});

test("trackExecution lanza y no ejecuta la llamada cuando el tope está superado", async () => {
  seedBudget("10");
  seedPrice();
  seedSpend(12_000);

  await assert.rejects(
    () =>
      trackExecution({ phase: "RESEARCH" }, async () => {
        calls.tracked++;
        return { value: "no debería llegar aquí" };
      }),
    (err: unknown) => {
      assert.ok(err instanceof BudgetExceededError, "debería ser un BudgetExceededError");
      assert.match((err as Error).message, /presupuesto/i);
      return true;
    },
  );
  assert.equal(calls.tracked, 0, "la búsqueda web nativa se ejecutó pese al tope");
});

test("trackExecution sigue funcionando con el tope sin superar", async () => {
  seedBudget("10");
  seedPrice();
  seedSpend(1_000);

  const out = await trackExecution({ phase: "RESEARCH" }, async () => {
    calls.tracked++;
    return { value: "ok", model: "deepseek-chat" };
  });

  assert.equal(out, "ok");
  assert.equal(calls.tracked, 1);
});

test("solo cuenta el gasto del MES natural en curso", async () => {
  seedProvider();
  seedBudget("10");
  seedPrice();
  // Gasto grande pero del mes pasado: no debe bloquear el mes actual.
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  lastMonth.setDate(15);
  seedSpend(999_000, { createdAt: lastMonth });

  const status = await getMonthlyBudgetStatus();
  assert.equal(status.spentUsd, 0, "está contando gasto de meses anteriores");

  const r = await execute("user-1", REQ);
  assert.equal(r.status, "SUCCESS");
  assert.equal(calls.runAPI, 1);
});

test("un tope de 0 (o vacío) equivale a 'sin tope'", async () => {
  seedProvider();
  seedBudget("0");
  seedPrice();
  seedSpend(999_000);

  const status = await getMonthlyBudgetStatus();
  assert.equal(status.budgetUsd, null);

  const r = await execute("user-1", REQ);
  assert.equal(r.status, "SUCCESS");
});

test("los modelos sin tarifa no suman al gasto y se señalan (el tope infraestima)", async () => {
  seedBudget("10");
  // Sin ModelPrice para "deepseek-chat": el coste de esos tokens es desconocido.
  seedSpend(999_000);

  const status = await getMonthlyBudgetStatus();
  assert.equal(status.spentUsd, 0);
  assert.equal(status.exceeded, false);
  assert.equal(
    status.hasUnpricedModels,
    true,
    "hay que avisar de que el gasto calculado se queda corto",
  );
});

test("la investigación IA se aborta al primer bloqueo, sin gastar en Tavily", async () => {
  // OpenAI (búsqueda nativa, pasa por trackExecution) + Tavily como respaldo.
  db.seed("lLMProvider", {
    userId: "user-1",
    providerType: "OPENAI",
    displayName: "OpenAI test",
    encryptedApiKey: encrypt("sk-test"),
    baseUrl: null,
    defaultModel: null,
    isActive: true,
    isDefaultResearch: false,
  });
  db.seed("lLMProvider", {
    userId: "user-1",
    providerType: "TAVILY",
    displayName: "Tavily test",
    encryptedApiKey: encrypt("tvly-test"),
    baseUrl: null,
    defaultModel: null,
    isActive: true,
    isDefaultResearch: false,
  });
  seedBudget("10");
  seedPrice();
  seedSpend(12_000);

  let tavilyCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    tavilyCalls++;
    return new Response(JSON.stringify({ results: [] }), { status: 200 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      () => runAIResearch({ userId: "user-1", brief: "novedades IA" }),
      /presupuesto/i,
      "el error del tope debe llegar entero al caller, no diluido en 'intentos'",
    );
    assert.equal(tavilyCalls, 0, "gastó créditos de Tavily con el presupuesto agotado");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("el acumulado se calcula agregando, sin traer las filas", async () => {
  seedBudget("10");
  seedPrice();
  seedSpend(1_000);
  seedSpend(1_500);

  const status = await getMonthlyBudgetStatus();

  assert.equal(status.spentUsd, 2.5);
  assert.equal(status.budgetUsd, 10);
  assert.equal(status.exceeded, false);
});
