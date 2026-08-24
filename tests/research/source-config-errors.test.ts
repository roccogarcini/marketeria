import test, { before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * Errores al parsear el `configJson` de una fuente.
 *
 * Un JSON de configuración mal formado no se traga en silencio. Si se
 * ignorase, la ejecución seguiría con los valores por defecto y quien opera
 * vería "0 hallazgos" o un mensaje falso ("Source YOUTUBE sin 'query' en
 * configJson") cuando la query SÍ está escrita: lo que falla es el JSON.
 *
 * Lo que se prueba: el error que llega a quien opera dice que el configJson no
 * es JSON válido, y una configuración correcta sigue funcionando igual.
 */

process.env.ENCRYPTION_KEY = "test-encryption-key-para-los-tests-de-spaider";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const YOUTUBE = pathToFileURL(path.join(ROOT, "src/lib/youtube/client.ts")).href;
const APIFY = pathToFileURL(path.join(ROOT, "src/lib/apify/client.ts")).href;
const AI_RESEARCH = pathToFileURL(path.join(ROOT, "src/lib/research/ai-research.ts")).href;

const db = createFakePrisma();
const calls = { youtube: 0, apify: 0, research: 0, apifyActors: [] as string[] };

let runSourceFetch: typeof import("@/lib/research/fetcher").runSourceFetch;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  mock.module(YOUTUBE, {
    namedExports: {
      getYouTubeApiKey: async () => "fake-key",
      searchYouTubeVideos: async () => {
        calls.youtube++;
        return [];
      },
      normalizeYouTubeVideo: (v: unknown) => v,
    },
  });
  mock.module(APIFY, {
    namedExports: {
      getApifyToken: async () => "fake-token",
      runApifyActor: async (_token: string, actorId: string) => {
        calls.apify++;
        calls.apifyActors.push(actorId);
        return [];
      },
      mapGenericApifyItem: () => null,
    },
  });
  mock.module(AI_RESEARCH, {
    namedExports: {
      runAIResearch: async () => {
        calls.research++;
        return { findings: [], via: "native", provider: "OPENAI", requestedProvider: null, attempts: [] };
      },
    },
  });
  ({ runSourceFetch } = await import("@/lib/research/fetcher"));
});

beforeEach(() => {
  db.reset();
  calls.youtube = 0;
  calls.apify = 0;
  calls.research = 0;
  calls.apifyActors = [];
});

function seedSource(type: string, configJson: string | null, extra: Record<string, unknown> = {}) {
  db.seed("source", { id: `src-${type}`, name: `Fuente ${type}`, type, configJson, ...extra });
  return `src-${type}`;
}

const BROKEN = '{"query": "agentes IA",}'; // coma final: JSON inválido

test("YOUTUBE con configJson roto: el error dice que el JSON no es válido, no que falte la query", async () => {
  const id = seedSource("YOUTUBE", BROKEN);
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.ok(out.error, "la fuente debería fallar con un error");
  assert.match(
    out.error ?? "",
    /configJson/i,
    "el error no menciona el configJson",
  );
  assert.match(
    out.error ?? "",
    /no es JSON v[áa]lido/i,
    `el operador solo ve "${out.error}": parece que falte la query, cuando lo roto es el JSON`,
  );
  assert.equal(calls.youtube, 0, "no debería llegar a llamar a YouTube con una config rota");
});

test("APIFY con configJson roto: mismo error explícito, sin caer a los defaults", async () => {
  const id = seedSource("APIFY", BROKEN, { platform: "INSTAGRAM" });
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.ok(out.error);
  assert.match(out.error ?? "", /configJson/i);
  assert.match(out.error ?? "", /no es JSON v[áa]lido/i, `el operador solo ve "${out.error}"`);
  assert.equal(calls.apify, 0, "no debería lanzar el actor con una config rota");
});

test("AI_RESEARCH con configJson roto: mismo error explícito", async () => {
  const id = seedSource("AI_RESEARCH", BROKEN);
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.ok(out.error);
  assert.match(out.error ?? "", /configJson/i);
  assert.match(out.error ?? "", /no es JSON v[áa]lido/i, `el operador solo ve "${out.error}"`);
  assert.equal(calls.research, 0, "no debería lanzar la investigación con una config rota");
});

test("un configJson correcto sigue funcionando igual (no rompemos el camino bueno)", async () => {
  const id = seedSource("YOUTUBE", JSON.stringify({ query: "agentes IA", maxItems: 5 }));
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.equal(out.error, null, `no debería fallar: ${out.error}`);
  assert.equal(calls.youtube, 1);
});

test("una fuente sin configJson mantiene el error de siempre (falta la query)", async () => {
  const id = seedSource("YOUTUBE", null);
  const out = await runSourceFetch(id, { userId: "user-1" });
  assert.match(out.error ?? "", /query/i);
});

test("APIFY en modo dinámico sigue usando el actor del configJson", async () => {
  const id = seedSource(
    "APIFY",
    JSON.stringify({ dynamic: true, actorId: "usuario~mi-actor", input: { url: "x" } }),
    { platform: "INSTAGRAM" },
  );
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.equal(out.error, null, `no debería fallar: ${out.error}`);
  assert.deepEqual(calls.apifyActors, ["usuario~mi-actor"]);
});

test("APIFY por plataforma sigue usando la query y el actor por defecto", async () => {
  const id = seedSource("APIFY", JSON.stringify({ query: "marketing IA", maxItems: 10 }), {
    platform: "INSTAGRAM",
  });
  const out = await runSourceFetch(id, { userId: "user-1" });

  assert.equal(out.error, null, `no debería fallar: ${out.error}`);
  assert.equal(calls.apify, 1);
  assert.notEqual(calls.apifyActors[0], undefined, "no se ha resuelto ningún actor por defecto");
});
