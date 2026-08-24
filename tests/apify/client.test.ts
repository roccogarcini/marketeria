import test, { before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * El token de Apify viaja en la cabecera, nunca en la query string.
 *
 * Todo el cliente (`runApifyActor`, `validateApifyToken`, `listApifyActors`,
 * `getApifyActorSchema`) usa `Authorization: Bearer`. Una URL con el token
 * dentro acabaría en los logs de cualquier proxy intermedio, en el historial
 * de trazas y en los mensajes de error que incluyen la URL.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const db = createFakePrisma();

let runApifyActor: typeof import("@/lib/apify/client").runApifyActor;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  ({ runApifyActor } = await import("@/lib/apify/client"));
});

const realFetch = globalThis.fetch;
let seen: { url: string; init: RequestInit | undefined } | null = null;

beforeEach(() => {
  seen = null;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(input), init };
    return new Response(JSON.stringify([{ title: "item", url: "https://x.test/1" }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function headerOf(init: RequestInit | undefined, name: string): string | null {
  return new Headers(init?.headers as HeadersInit | undefined).get(name);
}

test("runApifyActor NO manda el token en la query string", async () => {
  await runApifyActor("apify_api_SECRETO", "usuario~actor", { q: "test" }, { maxItems: 5 });

  assert.ok(seen, "no se llegó a llamar a fetch");
  assert.ok(
    !seen!.url.includes("apify_api_SECRETO"),
    `el token aparece en la URL: ${seen!.url}`,
  );
  assert.ok(!/[?&]token=/.test(seen!.url), `la URL sigue llevando ?token=: ${seen!.url}`);
});

test("runApifyActor autentica con la cabecera Authorization: Bearer", async () => {
  await runApifyActor("apify_api_SECRETO", "usuario~actor", { q: "test" });

  assert.equal(headerOf(seen!.init, "authorization"), "Bearer apify_api_SECRETO");
  assert.equal(headerOf(seen!.init, "content-type"), "application/json");
});

test("runApifyActor conserva el resto de la query (limit) y el actor normalizado", async () => {
  await runApifyActor("apify_api_SECRETO", "usuario/actor", {}, { maxItems: 7 });

  const url = new URL(seen!.url);
  assert.equal(url.pathname, "/v2/acts/usuario~actor/run-sync-get-dataset-items");
  assert.equal(url.searchParams.get("limit"), "7");
  assert.equal(url.searchParams.get("token"), null);
});
