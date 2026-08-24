import test, { before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFakePrisma } from "../helpers/fake-prisma.ts";

/**
 * Deduplicación de la investigación IA lanzada desde la API v1 / MCP.
 *
 * `runResearchOp` reutiliza la misma Source entre llamadas. El dedupe de
 * hallazgos filtra por sourceId: con un id nuevo en cada llamada nunca
 * encontraría duplicados, repetir la misma investigación reinsertaría los
 * mismos hallazgos y dejaría una fila huérfana en `Source` por ejecución.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const AI_RESEARCH = pathToFileURL(path.join(ROOT, "src/lib/research/ai-research.ts")).href;

const db = createFakePrisma();

const FINDINGS = [
  {
    title: "Hallazgo A",
    url: "https://ejemplo.test/a",
    snippet: "snippet a",
    summary: null,
    author: null,
    publishedAt: new Date(),
  },
  {
    title: "Hallazgo B",
    url: "https://ejemplo.test/b",
    snippet: "snippet b",
    summary: null,
    author: null,
    publishedAt: new Date(),
  },
];

let runResearchOp: typeof import("@/lib/api/operations").runResearchOp;

before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: db.prisma } });
  mock.module(AI_RESEARCH, {
    namedExports: {
      runAIResearch: async () => ({
        findings: FINDINGS,
        via: "native",
        provider: "OPENAI",
        requestedProvider: null,
        attempts: [],
      }),
      providerSupportsNativeSearch: () => true,
      briefWantsHistory: () => false,
      applyRecencyFilter: (f: unknown[]) => ({ kept: f, dropped: 0 }),
      RECENCY_DEFAULT_MONTHS: 6,
    },
  });
  ({ runResearchOp } = await import("@/lib/api/operations"));
});

beforeEach(() => db.reset());

test("investigar dos veces el mismo brief reutiliza la Source y no duplica hallazgos", async () => {
  const brief = "novedades de agentes IA en julio de 2026";

  const first = await runResearchOp("user-1", brief, 5);
  const second = await runResearchOp("user-1", brief, 5);

  assert.equal(
    db.rows("source").length,
    1,
    "cada investigación repetida crea una Source nueva (filas huérfanas en Source)",
  );
  assert.equal(first.sourceId, second.sourceId, "la segunda investigación debe reutilizar la Source");
  assert.equal(first.created, 2);
  assert.equal(second.created, 0, "la repetición no debe crear hallazgos nuevos");
  assert.equal(second.skipped, 2, "la repetición debe contarlos como duplicados saltados");
  assert.equal(db.rows("finding").length, 2, "los hallazgos se han duplicado en la tabla Finding");
  assert.equal(second.error, null);
});

test("briefs distintos siguen usando Sources distintas", async () => {
  const a = await runResearchOp("user-1", "brief uno");
  const b = await runResearchOp("user-1", "brief dos");
  assert.notEqual(a.sourceId, b.sourceId);
  assert.equal(db.rows("source").length, 2);
});

test("un insert simultáneo no crea un hallazgo duplicado (índice único, no findFirst)", async () => {
  // La ventana entre findFirst y create permitía que dos fetches concurrentes
  // de la misma fuente insertaran el mismo hallazgo. Aquí simulamos ese caso:
  // el hallazgo YA existe pero la comprobación previa no lo ve (como si la otra
  // transacción lo hubiese insertado justo después de leer).
  await runResearchOp("user-1", "brief de carrera");
  const before = db.rows("finding").length;
  assert.equal(before, 2);

  const findingModel = db.prisma.finding;
  const original = findingModel.findFirst;
  findingModel.findFirst = async () => null; // pre-check ciego durante todo el run

  try {
    const again = await runResearchOp("user-1", "brief de carrera");
    assert.equal(again.error, null, "una violación de unicidad no debe romper el fetch");
    assert.equal(
      db.rows("finding").length,
      before,
      "sin índice único, el insert concurrente duplica el hallazgo",
    );
    assert.equal(again.created, 0);
    assert.equal(again.skipped, 2);
  } finally {
    findingModel.findFirst = original;
  }
});
