import test, { before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Reserva de turno de las automatizaciones programadas.
 *
 * Con el guard de solape en un `Set` del proceso, dos réplicas dispararían
 * CADA tick del cron por duplicado y cada investigación programada se
 * ejecutaría dos veces (hallazgos duplicados y el doble de coste LLM).
 *
 * Aquí se prueba el cableado: el tick pide turno a la BD y no ejecuta si no lo
 * consigue. La ATOMICIDAD de la reserva la pone Postgres (UPDATE condicional
 * con RETURNING sobre una fila) y NO está cubierta por este test: emular la
 * serialización de un UPDATE en un doble en memoria solo probaría el doble.
 * Ver `src/lib/automations/claim.ts`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = pathToFileURL(path.join(ROOT, "src/lib/automations/runner.ts")).href;
const CLAIM = pathToFileURL(path.join(ROOT, "src/lib/automations/claim.ts")).href;

const calls = { runs: [] as string[], claims: [] as Array<[string, number]> };
/** Turnos que concede la "BD": una sola réplica se lo lleva. */
let grants: boolean[] = [];
/** Si está puesto, el run revienta (para probar que el guard se libera). */
let runFails = false;

let runScheduledTick: typeof import("@/lib/automations/scheduler").runScheduledTick;
let claimWindowMsFor: typeof import("@/lib/automations/claim").claimWindowMsFor;

before(async () => {
  mock.module(RUNNER, {
    namedExports: {
      runAutomation: async (id: string) => {
        calls.runs.push(id);
        if (runFails) throw new Error("la fuente ha petado");
      },
    },
  });
  mock.module(CLAIM, {
    namedExports: {
      claimScheduledRun: async (id: string, windowMs: number) => {
        calls.claims.push([id, windowMs]);
        return grants.shift() ?? false;
      },
      claimWindowMsFor: (expr: string) => (expr.trim().split(/\s+/).length >= 6 ? 0 : 30_000),
    },
  });
  ({ runScheduledTick } = await import("@/lib/automations/scheduler"));
  ({ claimWindowMsFor } = await import("@/lib/automations/claim"));
});

beforeEach(() => {
  calls.runs = [];
  calls.claims = [];
  grants = [];
  runFails = false;
});

test("dos réplicas con el mismo tick: solo la que consigue el turno ejecuta", async () => {
  grants = [true, false]; // la primera se lleva la reserva, la segunda no

  await runScheduledTick("auto-1", "Investigación diaria", 30_000);
  await runScheduledTick("auto-1", "Investigación diaria", 30_000);

  assert.deepEqual(calls.claims, [
    ["auto-1", 30_000],
    ["auto-1", 30_000],
  ]);
  assert.deepEqual(
    calls.runs,
    ["auto-1"],
    "la automatización se ha ejecutado dos veces: hallazgos duplicados y doble coste",
  );
});

test("si el turno se concede, se ejecuta con normalidad", async () => {
  grants = [true];
  await runScheduledTick("auto-2", "Otra", 30_000);
  assert.deepEqual(calls.runs, ["auto-2"]);
});

test("un fallo del run no deja el guard de solape pillado", async () => {
  grants = [true, true];
  runFails = true;

  await runScheduledTick("auto-3", "Falla", 30_000);
  await runScheduledTick("auto-3", "Falla", 30_000);
  assert.equal(calls.runs.length, 2, "tras un fallo el siguiente tick debe poder ejecutarse");
});

test("la ventana de reserva se apaga en crons con segundos y vale 30s en los normales", () => {
  assert.equal(claimWindowMsFor("0 8 * * *"), 30_000);
  assert.equal(claimWindowMsFor("*/5 * * * *"), 30_000);
  assert.equal(claimWindowMsFor("*/10 * * * * *"), 0, "un cron por segundos no debe perder disparos");
});
