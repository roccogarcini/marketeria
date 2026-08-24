import test, { before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * H2 — Los clientes de las APIs externas no reintentaban nada.
 *
 * El test del helper (tests/net/retry.test.ts) prueba la mecánica; este prueba
 * que los sitios que hacen la llamada de verdad la usan: un 429/5xx puntual de
 * Tavily, Apify, YouTube o la fuente URL/RSS ya no tumba la ejecución del cron.
 *
 * Las respuestas de error llevan `Retry-After: 0` para que el test no espere:
 * el camino de Retry-After es justo el que interesa comprobar.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const db = createFakePrisma();
const RETRY_NOW = { "Retry-After": "0" };
const URL_OK = "https://93.184.216.34/pagina"; // IP pública literal: no toca DNS

let tavilySearch: typeof import("@/lib/research/tavily").tavilySearch;
let runApifyActor: typeof import("@/lib/apify/client").runApifyActor;
let searchYouTubeVideos: typeof import("@/lib/youtube/client").searchYouTubeVideos;
let fetchWithTimeout: typeof import("@/lib/research/fetcher").fetchWithTimeout;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  ({ tavilySearch } = await import("@/lib/research/tavily"));
  ({ runApifyActor } = await import("@/lib/apify/client"));
  ({ searchYouTubeVideos } = await import("@/lib/youtube/client"));
  ({ fetchWithTimeout } = await import("@/lib/research/fetcher"));
});

const realFetch = globalThis.fetch;

/** fetch que devuelve `fails` errores y después la respuesta buena. */
function failThen(fails: Array<[number, Record<string, string>?]>, ok: () => Response) {
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    const i = calls.n++;
    if (i < fails.length) {
      const [status, headers] = fails[i];
      return new Response("rate limited", { status, headers: { ...RETRY_NOW, ...headers } });
    }
    return ok();
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("Tavily: un 429 puntual ya no tumba la búsqueda", async () => {
  const calls = failThen(
    [[429]],
    json({
      results: [{ title: "Resultado", url: "https://x.test/1", content: "texto" }],
    }),
  );

  const out = await tavilySearch("tvly-test", "agentes IA");

  assert.equal(calls.n, 2, "no reintentó tras el 429");
  assert.equal(out.length, 1);
  assert.equal(out[0].url, "https://x.test/1");
});

test("Apify: un 503 puntual ya no tumba el run del actor", async () => {
  const calls = failThen([[503]], json([{ title: "item", url: "https://x.test/2" }]));

  const items = await runApifyActor("apify_api_TEST", "usuario~actor", {});

  assert.equal(calls.n, 2, "no reintentó tras el 503");
  assert.equal(items.length, 1);
});

test("YouTube: un 500 puntual ya no tumba la búsqueda", async () => {
  let n = 0;
  globalThis.fetch = (async () => {
    n++;
    if (n === 1) return new Response("boom", { status: 500, headers: RETRY_NOW });
    if (n === 2) {
      return new Response(JSON.stringify({ items: [{ id: { videoId: "abc" } }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ items: [{ id: "abc", snippet: { title: "Vídeo" } }] }),
      { status: 200 },
    );
  }) as typeof fetch;

  const videos = await searchYouTubeVideos("yt-key", { query: "ia" });

  assert.equal(n, 3, "no reintentó el search tras el 500");
  assert.equal(videos.length, 1);
});

test("fuente URL/RSS: un 502 puntual ya no tumba el fetch de la fuente", async () => {
  const calls = failThen([[502]], () => new Response("<html><title>Ok</title></html>", { status: 200 }));

  const html = await fetchWithTimeout(URL_OK);

  assert.equal(calls.n, 2, "no reintentó tras el 502");
  assert.match(html, /<title>Ok<\/title>/);
});

test("un 401 de Tavily NO se reintenta: es configuración, no un pico", async () => {
  const calls = failThen([[401], [401], [401]], json({ results: [] }));

  await assert.rejects(() => tavilySearch("tvly-mala", "agentes IA"), /401/);
  assert.equal(calls.n, 1, "reintentar una clave inválida solo retrasa el error");
});

test("si el 429 no cede, el error final sigue llegando al caller", async () => {
  const calls = failThen([[429], [429], [429]], json({ results: [] }));

  await assert.rejects(() => tavilySearch("tvly-test", "agentes IA"), /429/);
  assert.equal(calls.n, 3, "tope de 3 intentos");
});
