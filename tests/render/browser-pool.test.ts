import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  withRenderBrowser,
  resetRenderPool,
  RenderBusyError,
  type RenderBrowser,
} from "@/lib/render/browser-pool";

/**
 * Pool de Chromium para la exportación PNG.
 *
 * Cada instancia son ~200 MB de RSS y ~1 s de arranque: sin tope, tres o
 * cuatro exportaciones simultáneas se comen la memoria del contenedor y
 * tumban la app entera, no solo la exportación.
 *
 * Lo que se prueba: tope de renderizados simultáneos, reutilización de la
 * instancia, liberación del slot aunque el render falle, respuesta "ocupado"
 * cuando la cola no se despeja, y que la ruta de exportación usa el pool en vez
 * de llamar a `puppeteer.launch` por su cuenta.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Chromium de mentira: cuenta lanzamientos, páginas abiertas y cierres. */
function fakeBrowsers() {
  const stats = { launched: 0, closed: 0, pages: 0 };
  const launch = async (): Promise<RenderBrowser> => {
    stats.launched++;
    return {
      connected: true,
      newPage: async () => {
        stats.pages++;
        return { close: async () => {} };
      },
      close: async () => {
        stats.closed++;
      },
    };
  };
  return { stats, launch };
}

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

beforeEach(() => resetRenderPool());
afterEach(() => resetRenderPool());

test("nunca hay más renderizados simultáneos que el tope configurado", async () => {
  const { launch } = fakeBrowsers();
  let concurrent = 0;
  let peak = 0;
  const gate = defer();

  const runs = Array.from({ length: 6 }, () =>
    withRenderBrowser(
      async () => {
        concurrent++;
        peak = Math.max(peak, concurrent);
        await gate.promise;
        concurrent--;
      },
      { launch, maxConcurrent: 2 },
    ),
  );

  // Deja que arranquen todas las que puedan.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(peak, 2, `se han solapado ${peak} renderizados con un tope de 2`);

  gate.resolve();
  await Promise.all(runs);
  assert.equal(peak, 2);
});

test("seis exportaciones seguidas comparten un solo Chromium", async () => {
  const { stats, launch } = fakeBrowsers();

  for (let i = 0; i < 6; i++) {
    await withRenderBrowser(async (b) => void (await b.newPage()), {
      launch,
      maxConcurrent: 2,
      idleCloseMs: 60_000,
    });
  }

  assert.equal(stats.launched, 1, `se han lanzado ${stats.launched} Chromium para 6 exportaciones`);
  assert.equal(stats.pages, 6);
});

test("el slot se libera aunque el renderizado falle", async () => {
  const { launch } = fakeBrowsers();

  await assert.rejects(
    withRenderBrowser(
      async () => {
        throw new Error("slide roto");
      },
      { launch, maxConcurrent: 1 },
    ),
    /slide roto/,
  );

  // Si el slot no se liberase, esta segunda llamada se quedaría colgada.
  let ok = false;
  await withRenderBrowser(
    async () => {
      ok = true;
    },
    { launch, maxConcurrent: 1, queueWaitMs: 200 },
  );
  assert.equal(ok, true, "el slot se ha quedado pillado tras un fallo");
});

test("si la cola no se despeja se responde 'ocupado' (503), no se acumulan peticiones", async () => {
  const { launch } = fakeBrowsers();
  const gate = defer();

  const busy = withRenderBrowser(async () => void (await gate.promise), {
    launch,
    maxConcurrent: 1,
  });

  await assert.rejects(
    withRenderBrowser(async () => {}, { launch, maxConcurrent: 1, queueWaitMs: 30 }),
    (err: unknown) => {
      assert.ok(err instanceof RenderBusyError, "el error debería ser RenderBusyError");
      assert.equal((err as RenderBusyError).status, 503);
      return true;
    },
  );

  gate.resolve();
  await busy;
});

test("si el Chromium compartido se ha caído, se relanza", async () => {
  const { stats, launch } = fakeBrowsers();
  let saved: RenderBrowser | null = null;

  await withRenderBrowser(async (b) => {
    saved = b;
  }, { launch });
  (saved as unknown as { connected: boolean }).connected = false; // simula un crash

  await withRenderBrowser(async () => {}, { launch });
  assert.equal(stats.launched, 2, "un Chromium caído debe relanzarse");
});

test("la ruta de exportación PNG usa el pool, no puppeteer.launch por su cuenta", async () => {
  const route = fs.readFileSync(
    path.join(ROOT, "src/app/api/assets/[id]/export-png/route.ts"),
    "utf8",
  );
  assert.ok(
    !/puppeteer\.launch/.test(route),
    "la ruta sigue lanzando un Chromium por petición",
  );
  assert.match(route, /withRenderBrowser/, "la ruta no pasa por el pool");
});
