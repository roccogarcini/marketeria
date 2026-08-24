import test, { before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakePrisma, type Row } from "../helpers/fake-prisma.ts";

/**
 * El gasto LLM de la investigación IA se contabiliza.
 *
 * Las tres llamadas al LLM de `runAIResearch` (búsqueda nativa OpenAI,
 * búsqueda nativa z.ai y estructuración de resultados Tavily) pasan por
 * `execute()`, que es lo único que escribe en `AIExecution`. Sin eso, una
 * investigación serían 8-10 llamadas LLM invisibles en /admin/consumo.
 *
 * Cada test comprueba que la vía correspondiente deja su fila en AIExecution
 * con fase, modelo y tokens.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AI_API = pathToFileURL(path.join(ROOT, "src/lib/ai/api.ts")).href;

const db = createFakePrisma();

/** Respuesta del LLM: un array JSON de hallazgos con fecha de hoy (pasa el filtro de actualidad). */
function findingsJson(): string {
  return JSON.stringify([
    {
      title: "Hallazgo reciente",
      url: "https://ejemplo.test/reciente",
      snippet: "Resumen corto.",
      publishedAt: new Date().toISOString(),
    },
  ]);
}

// Doble de @/lib/ai/api: ni el SDK de OpenAI ni runAPI deben salir a la red.
const apiCalls: { openaiChatCreate: number; runAPI: number } = {
  openaiChatCreate: 0,
  runAPI: 0,
};

let runAIResearch: typeof import("@/lib/research/ai-research").runAIResearch;
let encrypt: typeof import("@/lib/crypto").encrypt;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  mock.module(AI_API, {
    namedExports: {
      openaiChatCreate: async () => {
        apiCalls.openaiChatCreate++;
        return {
          model: "gpt-4o-mini-search-preview",
          choices: [{ message: { content: findingsJson() } }],
          usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
        };
      },
      runAPI: async () => {
        apiCalls.runAPI++;
        return {
          output: findingsJson(),
          model: "deepseek-chat",
          tokenUsage: { promptTokens: 500, completionTokens: 300, totalTokens: 800 },
        };
      },
      openaiCompatClientFor: () => {
        throw new Error("no usado en este test");
      },
      pingProvider: async () => undefined,
      listProviderModels: async () => [],
    },
  });
  ({ encrypt } = await import("@/lib/crypto"));
  ({ runAIResearch } = await import("@/lib/research/ai-research"));
});

const realFetch = globalThis.fetch;

beforeEach(() => {
  db.reset();
  apiCalls.openaiChatCreate = 0;
  apiCalls.runAPI = 0;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function seedProvider(providerType: string, extra: Row = {}) {
  db.seed("lLMProvider", {
    userId: "user-1",
    providerType,
    displayName: `${providerType} test`,
    encryptedApiKey: encrypt("sk-test"),
    baseUrl: null,
    defaultModel: null,
    isActive: true,
    isDefaultResearch: false,
    ...extra,
  });
}

test("la búsqueda web nativa de OpenAI queda registrada en AIExecution", async () => {
  seedProvider("OPENAI");

  const res = await runAIResearch({
    userId: "user-1",
    brief: "novedades de agentes IA",
    sourceId: "source-1",
  });

  assert.equal(res.via, "native");
  assert.equal(apiCalls.openaiChatCreate, 1);

  const execs = db.rows("aIExecution");
  assert.equal(execs.length, 1, "la búsqueda nativa de OpenAI no deja rastro en AIExecution");
  assert.equal(execs[0].phase, "RESEARCH");
  assert.equal(execs[0].status, "SUCCESS");
  assert.equal(execs[0].executionMode, "API");
  assert.equal(execs[0].modelUsed, "gpt-4o-mini-search-preview");
  assert.equal(execs[0].inputTokens, 1200);
  assert.equal(execs[0].outputTokens, 800);
  assert.equal(execs[0].refId, "source-1");
});

test("la búsqueda web nativa de z.ai queda registrada en AIExecution", async () => {
  seedProvider("ZAI");

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        model: "glm-4.6",
        choices: [{ message: { content: findingsJson() } }],
        usage: { prompt_tokens: 900, completion_tokens: 400, total_tokens: 1300 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const res = await runAIResearch({
    userId: "user-1",
    brief: "novedades de agentes IA",
    sourceId: "source-2",
  });

  assert.equal(res.via, "native");
  const execs = db.rows("aIExecution");
  assert.equal(execs.length, 1, "la búsqueda nativa de z.ai no deja rastro en AIExecution");
  assert.equal(execs[0].modelUsed, "glm-4.6");
  assert.equal(execs[0].inputTokens, 900);
  assert.equal(execs[0].outputTokens, 400);
});

test("la estructuración con Tavily queda registrada en AIExecution", async () => {
  seedProvider("DEEPSEEK"); // sin búsqueda nativa → cae a Tavily
  seedProvider("TAVILY", { displayName: "Tavily test" });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "Resultado Tavily",
            url: "https://ejemplo.test/tavily",
            content: "Contenido del resultado.",
            published_date: new Date().toISOString(),
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const res = await runAIResearch({
    userId: "user-1",
    brief: "novedades de agentes IA",
    sourceId: "source-3",
  });

  assert.equal(res.via, "tavily");
  assert.equal(apiCalls.runAPI, 1);

  const execs = db.rows("aIExecution");
  assert.equal(execs.length, 1, "la estructuración vía Tavily no deja rastro en AIExecution");
  assert.equal(execs[0].phase, "RESEARCH");
  assert.equal(execs[0].status, "SUCCESS");
  assert.equal(execs[0].inputTokens, 500);
  assert.equal(execs[0].outputTokens, 300);
});
