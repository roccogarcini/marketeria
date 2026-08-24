/**
 * Pool de Chromium para la exportación PNG de carruseles.
 *
 * Un Chromium por petición a `/api/assets/[id]/export-png` (~200 MB de RSS y
 * ~1 s de arranque) sin ningún control se come la memoria del contenedor en
 * cuanto coinciden tres o cuatro exportaciones, y tumba la app entera, no solo
 * la exportación.
 *
 * Aquí hay dos cosas:
 *  1. Un semáforo: como mucho `PNG_EXPORT_CONCURRENCY` renderizados a la vez.
 *     El resto espera en cola; si la espera se pasa de `PNG_EXPORT_QUEUE_WAIT_MS`
 *     se responde "ocupado" (503) en vez de acumular peticiones colgadas.
 *  2. Una instancia de Chromium COMPARTIDA: se lanza en el primer uso, la
 *     reutilizan todas las exportaciones y se cierra sola tras un rato sin uso.
 *
 * Ojo: el estado vive en el proceso (mismo patrón que `lib/prisma.ts`). Con dos
 * réplicas cada una tendría su propio tope. Ver la nota de operación en el
 * README ("Una sola réplica").
 */

export type RenderPage = {
  close(): Promise<void>;
  [k: string]: unknown;
};

export type RenderBrowser = {
  newPage(): Promise<RenderPage>;
  close(): Promise<void>;
  connected?: boolean;
};

export type Launcher = () => Promise<RenderBrowser>;

/** Se devuelve al caller como 503: la app está ocupada, no rota. */
export class RenderBusyError extends Error {
  readonly status = 503;
  constructor(waitedMs: number) {
    super(
      `Exportación ocupada: hay demasiados renderizados en curso (esperando ${Math.round(
        waitedMs / 1000,
      )}s). Vuelve a intentarlo en un momento.`,
    );
    this.name = "RenderBusyError";
  }
}

const DEFAULT_MAX_CONCURRENT = 2;
const DEFAULT_QUEUE_WAIT_MS = 45_000;
/** Tiempo sin uso tras el que se cierra el Chromium compartido. */
const IDLE_CLOSE_MS = 60_000;

function intFromEnv(name: string, fallback: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

type Waiter = { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

type PoolState = {
  active: number;
  queue: Waiter[];
  browser: RenderBrowser | null;
  launching: Promise<RenderBrowser> | null;
  idleTimer: NodeJS.Timeout | null;
};

// globalThis: sobrevive al HMR de dev, igual que lib/prisma.ts.
const globalForPool = globalThis as unknown as { __spaiderRenderPool?: PoolState };
const state: PoolState = (globalForPool.__spaiderRenderPool ??= {
  active: 0,
  queue: [],
  browser: null,
  launching: null,
  idleTimer: null,
});

function acquire(maxConcurrent: number, queueWaitMs: number): Promise<void> {
  if (state.active < maxConcurrent) {
    state.active++;
    return Promise.resolve();
  }
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = state.queue.findIndex((w) => w.timer === timer);
      if (i >= 0) state.queue.splice(i, 1);
      reject(new RenderBusyError(Date.now() - started));
    }, queueWaitMs);
    // El timer no debe mantener vivo el proceso por sí solo.
    timer.unref?.();
    state.queue.push({ resolve, reject, timer });
  });
}

function release() {
  const next = state.queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(); // el slot pasa directo al siguiente: `active` no baja
    return;
  }
  state.active--;
}

async function defaultLaunch(): Promise<RenderBrowser> {
  // Import dinámico — Puppeteer arrastra Chromium (~170 MB) y no queremos que
  // el resto de la app pague ese coste al arrancar.
  const puppeteer = (await import("puppeteer")).default;
  return (await puppeteer.launch({
    headless: true,
    // En Docker usa el Chromium del sistema (env del Dockerfile); en dev local
    // queda undefined y Puppeteer usa su Chrome descargado.
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      // El /dev/shm de 64MB por defecto en Docker se agota con slides 1080@2x
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--font-render-hinting=none",
    ],
  })) as unknown as RenderBrowser;
}

function isAlive(b: RenderBrowser | null): b is RenderBrowser {
  return !!b && b.connected !== false;
}

async function getBrowser(launch: Launcher): Promise<RenderBrowser> {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
  if (isAlive(state.browser)) return state.browser;
  // Un Chromium que se ha caído (OOM del contenedor, crash) se relanza.
  state.browser = null;
  state.launching ??= launch()
    .then((b) => {
      state.browser = b;
      return b;
    })
    .finally(() => {
      state.launching = null;
    });
  return state.launching;
}

function scheduleIdleClose(idleMs: number) {
  if (state.idleTimer || state.active > 0 || !state.browser) return;
  state.idleTimer = setTimeout(() => {
    state.idleTimer = null;
    if (state.active > 0) return;
    const b = state.browser;
    state.browser = null;
    void b?.close().catch(() => {});
  }, idleMs);
  state.idleTimer.unref?.();
}

/**
 * Ejecuta `fn` con un Chromium compartido, respetando el tope de renderizados
 * simultáneos. Lanza `RenderBusyError` si la cola no se despeja a tiempo.
 */
export async function withRenderBrowser<T>(
  fn: (browser: RenderBrowser) => Promise<T>,
  opts: {
    launch?: Launcher;
    maxConcurrent?: number;
    queueWaitMs?: number;
    idleCloseMs?: number;
  } = {},
): Promise<T> {
  const maxConcurrent =
    opts.maxConcurrent ?? intFromEnv("PNG_EXPORT_CONCURRENCY", DEFAULT_MAX_CONCURRENT, 1);
  const queueWaitMs =
    opts.queueWaitMs ?? intFromEnv("PNG_EXPORT_QUEUE_WAIT_MS", DEFAULT_QUEUE_WAIT_MS, 0);
  const idleCloseMs = opts.idleCloseMs ?? IDLE_CLOSE_MS;

  await acquire(maxConcurrent, queueWaitMs);
  try {
    const browser = await getBrowser(opts.launch ?? defaultLaunch);
    return await fn(browser);
  } finally {
    release();
    scheduleIdleClose(idleCloseMs);
  }
}

/** Solo para los tests: deja el pool como recién arrancado. */
export async function resetRenderPool(): Promise<void> {
  for (const w of state.queue.splice(0)) {
    clearTimeout(w.timer);
    w.reject(new Error("pool reiniciado"));
  }
  if (state.idleTimer) clearTimeout(state.idleTimer);
  state.idleTimer = null;
  state.active = 0;
  const b = state.browser;
  state.browser = null;
  state.launching = null;
  await b?.close().catch(() => {});
}
