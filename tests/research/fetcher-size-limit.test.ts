import test, { before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * `fetchWithTimeout` limita el tamaño de la respuesta que descarga.
 *
 * Un `await res.text()` a pelo acumula en memoria todo lo que mande el
 * servidor. Una fuente URL/RSS que responda con cientos de MB (o con un stream
 * que no acaba nunca) se comería la memoria del proceso: el timeout de 15 s no
 * protege de nada, porque el proceso puede morir antes por OOM.
 *
 * El tope (RESEARCH_MAX_RESPONSE_BYTES, 5 MB por defecto) corta el stream y
 * falla con un error claro.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const db = createFakePrisma();

// URL con IP pública literal: el guard anti-SSRF la acepta sin resolver DNS.
const URL_OK = "https://93.184.216.34/pagina";

let fetchWithTimeout: typeof import("@/lib/research/fetcher").fetchWithTimeout;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  ({ fetchWithTimeout } = await import("@/lib/research/fetcher"));
});

const realFetch = globalThis.fetch;
const envBefore = process.env.RESEARCH_MAX_RESPONSE_BYTES;

/** Stream de `chunks` trozos de 64 KB que cuenta cuántos se han llegado a pedir. */
function bigStream(chunks: number) {
  const stats = { pulled: 0, cancelled: false };
  const chunk = new Uint8Array(64 * 1024).fill(0x61); // 'a'
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (stats.pulled >= chunks) {
        controller.close();
        return;
      }
      stats.pulled++;
      controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { stream, stats };
}

beforeEach(() => {
  delete process.env.RESEARCH_MAX_RESPONSE_BYTES;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (envBefore === undefined) delete process.env.RESEARCH_MAX_RESPONSE_BYTES;
  else process.env.RESEARCH_MAX_RESPONSE_BYTES = envBefore;
});

test("una respuesta que supera el tope corta el stream y falla con un error claro", async () => {
  process.env.RESEARCH_MAX_RESPONSE_BYTES = "262144"; // 256 KB
  const { stream, stats } = bigStream(200); // 12,8 MB si se lee entero

  globalThis.fetch = (async () =>
    new Response(stream, { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;

  await assert.rejects(
    () => fetchWithTimeout(URL_OK),
    /demasiado grande|256|tope/i,
    "debería fallar en vez de tragarse la respuesta entera",
  );
  assert.ok(
    stats.pulled <= 8,
    `siguió leyendo tras el tope: ${stats.pulled} trozos de 64 KB pedidos`,
  );
  assert.equal(stats.cancelled, true, "el stream no se canceló al cortar");
});

test("Content-Length por encima del tope aborta sin leer el cuerpo", async () => {
  process.env.RESEARCH_MAX_RESPONSE_BYTES = "262144";
  const { stream, stats } = bigStream(200);

  globalThis.fetch = (async () =>
    new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/html", "Content-Length": "12800000" },
    })) as typeof fetch;

  await assert.rejects(() => fetchWithTimeout(URL_OK), /demasiado grande|tope/i);
  // <= 1: el ReadableStream pre-carga un trozo en su buffer al construirse,
  // pase lo que pase. Lo que importa es que no se drenan los 200.
  assert.ok(stats.pulled <= 1, `drenó el cuerpo pese al Content-Length: ${stats.pulled} trozos`);
  assert.equal(stats.cancelled, true, "no canceló el cuerpo tras rechazar por Content-Length");
});

test("una respuesta normal se sigue devolviendo entera", async () => {
  const html = "<html><head><title>Hola</title></head><body>contenido</body></html>";
  globalThis.fetch = (async () =>
    new Response(html, { status: 200, headers: { "Content-Type": "text/html" } })) as typeof fetch;

  assert.equal(await fetchWithTimeout(URL_OK), html);
});

test("el tope por defecto (5 MB) deja pasar una respuesta de 1 MB", async () => {
  const { stream } = bigStream(16); // 1 MB
  globalThis.fetch = (async () =>
    new Response(stream, { status: 200 })) as typeof fetch;

  const body = await fetchWithTimeout(URL_OK);
  assert.equal(body.length, 16 * 64 * 1024);
});
