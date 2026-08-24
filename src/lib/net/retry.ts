/**
 * Reintentos con backoff exponencial + jitter para las llamadas a APIs
 * externas (Tavily, Apify, YouTube, z.ai, OpenRouter, fuentes URL/RSS).
 *
 * Sin esto, un 429 puntual de cualquiera de ellas tumbaba la ejecución entera
 * del cron: la excepción sube hasta `runSourceFetch` y la fuente se queda sin
 * hallazgos hasta la pasada siguiente.
 *
 * Reglas:
 *  - Solo se reintenta lo TRANSITORIO: 408/425/429, 5xx de infraestructura y
 *    fallos de red. Un 401/403/404/422 es un problema de configuración y
 *    reintentarlo solo retrasa el error real.
 *  - Se respeta `Retry-After` (segundos o fecha HTTP). Si el servidor pide más
 *    de `maxDelayMs`, nos rendimos ya: esperar minutos dentro de una petición
 *    no arregla nada y bloquea el proceso.
 *  - Jitter completo (`random() * delay`) para no sincronizar los reintentos
 *    de varias fuentes que fallan a la vez.
 *  - Un abort del caller (su timeout) NUNCA se reintenta: el plazo ya venció.
 */

export type RetryOptions = {
  /** Intentos TOTALES, el primero incluido. Default 3. */
  attempts?: number;
  /** Base del backoff exponencial en ms. Default 500. */
  baseDelayMs?: number;
  /** Espera máxima entre intentos en ms. Default 10 000. */
  maxDelayMs?: number;
  /** Etiqueta para el log de reintentos (nombre del servicio). */
  label?: string;
};

const DEFAULTS = { attempts: 3, baseDelayMs: 500, maxDelayMs: 10_000 };

/** Estados HTTP que merecen otro intento. */
export function isRetriableStatus(status: number): boolean {
  return (
    status === 408 || // Request Timeout
    status === 425 || // Too Early
    status === 429 || // Too Many Requests
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

/**
 * `Retry-After` → ms de espera. Acepta el formato en segundos y la fecha HTTP.
 * Devuelve null si no viene o no se entiende; 0 si la fecha ya pasó.
 */
export function parseRetryAfterMs(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

/** Backoff exponencial con jitter completo, acotado por maxDelayMs. */
function backoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.floor(Math.random() * ceiling);
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * `fetch` con reintentos. Devuelve la ÚLTIMA respuesta aunque sea un error
 * (el caller sigue decidiendo qué hacer con el status), y propaga el último
 * error de red si nunca hubo respuesta.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  opts: RetryOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, opts.attempts ?? DEFAULTS.attempts);
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const signal = (init.signal ?? null) as AbortSignal | null;
  const label = opts.label ?? String(input);

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0 && signal?.aborted) break;
    try {
      const res = await fetch(input, init);
      if (attempt === attempts - 1 || !isRetriableStatus(res.status)) return res;

      // Cuánto esperar: lo que pida el servidor manda; si no dice nada, backoff.
      const asked = parseRetryAfterMs(res.headers.get("retry-after"));
      if (asked !== null && asked > maxDelayMs) {
        // Nos pide más de lo que estamos dispuestos a esperar dentro de esta
        // petición: devolvemos el error tal cual en vez de bloquear el proceso.
        return res;
      }
      const wait = asked ?? backoffMs(attempt, baseDelayMs, maxDelayMs);
      // La respuesta descartada se cierra: si no, la conexión queda colgada.
      await res.body?.cancel().catch(() => {});
      console.warn(
        `[retry] ${label}: HTTP ${res.status}, reintento ${attempt + 1}/${attempts - 1} en ${wait} ms`,
      );
      await sleep(wait, signal);
    } catch (err) {
      // El plazo del caller venció (o canceló): reintentar no tiene sentido.
      if (isAbort(err)) throw err;
      lastError = err;
      if (attempt === attempts - 1) throw err;
      const wait = backoffMs(attempt, baseDelayMs, maxDelayMs);
      console.warn(
        `[retry] ${label}: ${err instanceof Error ? err.message : "error de red"}, reintento ${attempt + 1}/${attempts - 1} en ${wait} ms`,
      );
      await sleep(wait, signal);
    }
  }
  throw lastError ?? new Error(`${label}: se agotaron los reintentos.`);
}
