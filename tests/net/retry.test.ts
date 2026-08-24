import test, { before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Reintentos ante 429 / 5xx en las APIs externas.
 *
 * Un 429 puntual de Tavily (o un 502 de Apify, o un corte de red) no puede
 * tumbar la ejecución ENTERA del cron: la excepción subiría hasta
 * runSourceFetch y la fuente se quedaría sin hallazgos hasta la pasada
 * siguiente.
 *
 * Este fichero prueba la pieza compartida: `fetchWithRetry` (backoff
 * exponencial + jitter, respeto de `Retry-After`, tope de intentos).
 */

let fetchWithRetry: typeof import("@/lib/net/retry").fetchWithRetry;
let parseRetryAfterMs: typeof import("@/lib/net/retry").parseRetryAfterMs;
let isRetriableStatus: typeof import("@/lib/net/retry").isRetriableStatus;

before(async () => {
  ({ fetchWithRetry, parseRetryAfterMs, isRetriableStatus } = await import("@/lib/net/retry"));
});

const realFetch = globalThis.fetch;
const FAST = { baseDelayMs: 1, maxDelayMs: 4 };

/** Encadena respuestas/errores: cada llamada a fetch consume el siguiente. */
function fetchSequence(steps: Array<Response | Error | (() => Response)>) {
  const calls = { n: 0 };
  globalThis.fetch = (async () => {
    const step = steps[Math.min(calls.n, steps.length - 1)];
    calls.n++;
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step() : step;
  }) as typeof fetch;
  return calls;
}

function res(status: number, body = "", headers: Record<string, string> = {}) {
  return () => new Response(body, { status, headers });
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("un 429 puntual se reintenta y la llamada acaba bien", async () => {
  const calls = fetchSequence([res(429), res(200, "ok")]);
  const r = await fetchWithRetry("https://api.test/x", {}, FAST);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "ok");
  assert.equal(calls.n, 2);
});

test("los 5xx transitorios se reintentan (502 → 503 → 200)", async () => {
  const calls = fetchSequence([res(502), res(503), res(200, "ok")]);
  const r = await fetchWithRetry("https://api.test/x", {}, { ...FAST, attempts: 3 });
  assert.equal(r.status, 200);
  assert.equal(calls.n, 3);
});

test("agotados los intentos se devuelve la última respuesta, no se reintenta sin fin", async () => {
  const calls = fetchSequence([res(429)]);
  const r = await fetchWithRetry("https://api.test/x", {}, { ...FAST, attempts: 3 });
  assert.equal(r.status, 429);
  assert.equal(calls.n, 3, "debería haber intentado exactamente 3 veces");
});

test("un 4xx que no es transitorio (401) no se reintenta", async () => {
  const calls = fetchSequence([res(401)]);
  const r = await fetchWithRetry("https://api.test/x", {}, FAST);
  assert.equal(r.status, 401);
  assert.equal(calls.n, 1);
});

test("un fallo de red se reintenta y luego se propaga si no cede", async () => {
  const boom = new TypeError("fetch failed");
  const calls = fetchSequence([boom]);
  await assert.rejects(() => fetchWithRetry("https://api.test/x", {}, { ...FAST, attempts: 3 }), {
    message: "fetch failed",
  });
  assert.equal(calls.n, 3);
});

test("un fallo de red que cede al segundo intento devuelve la respuesta buena", async () => {
  const calls = fetchSequence([new TypeError("fetch failed"), res(200, "ok")]);
  const r = await fetchWithRetry("https://api.test/x", {}, FAST);
  assert.equal(r.status, 200);
  assert.equal(calls.n, 2);
});

test("un abort (timeout del caller) NO se reintenta", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  const calls = fetchSequence([err]);
  await assert.rejects(() =>
    fetchWithRetry("https://api.test/x", { signal: ctl.signal }, { ...FAST, attempts: 3 }),
  );
  assert.equal(calls.n, 1, "el abort no debe consumir reintentos");
});

test("se respeta Retry-After en segundos", async () => {
  const calls = fetchSequence([res(429, "", { "Retry-After": "0" }), res(200, "ok")]);
  const t0 = Date.now();
  const r = await fetchWithRetry("https://api.test/x", {}, { ...FAST, attempts: 3 });
  assert.equal(r.status, 200);
  assert.equal(calls.n, 2);
  assert.ok(Date.now() - t0 < 500, "Retry-After: 0 no debería esperar");
});

test("un Retry-After mayor que el tope de espera se rinde sin reintentar", async () => {
  const calls = fetchSequence([res(429, "", { "Retry-After": "600" })]);
  const r = await fetchWithRetry("https://api.test/x", {}, { ...FAST, attempts: 3 });
  assert.equal(r.status, 429);
  assert.equal(calls.n, 1, "esperar 600 s no tiene sentido: mejor fallar ya");
});

test("parseRetryAfterMs entiende segundos y fecha HTTP", () => {
  const now = Date.parse("2026-07-25T10:00:00Z");
  assert.equal(parseRetryAfterMs("2", now), 2000);
  assert.equal(parseRetryAfterMs("0", now), 0);
  assert.equal(parseRetryAfterMs("Sat, 25 Jul 2026 10:00:03 GMT", now), 3000);
  assert.equal(parseRetryAfterMs("Sat, 25 Jul 2026 09:59:00 GMT", now), 0); // pasado → ya
  assert.equal(parseRetryAfterMs(null, now), null);
  assert.equal(parseRetryAfterMs("mañana", now), null);
});

test("isRetriableStatus cubre 408/425/429 y los 5xx transitorios", () => {
  for (const s of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isRetriableStatus(s), true, `${s} debería ser reintentable`);
  }
  for (const s of [200, 301, 400, 401, 403, 404, 422, 501]) {
    assert.equal(isRetriableStatus(s), false, `${s} NO debería reintentarse`);
  }
});

test("el cuerpo de la respuesta descartada se cierra antes de reintentar", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(16));
    },
    cancel() {
      cancelled = true;
    },
  });
  fetchSequence([
    () => new Response(stream, { status: 503 }),
    () => new Response("ok", { status: 200 }),
  ]);
  const r = await fetchWithRetry("https://api.test/x", {}, FAST);
  assert.equal(r.status, 200);
  assert.equal(cancelled, true, "la respuesta 503 descartada dejó la conexión abierta");
});
