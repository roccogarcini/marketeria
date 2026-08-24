/**
 * Rate-limit de login in-memory: 5 intentos fallidos por IP+email en una
 * ventana de 15 min. Suficiente para despliegue interno single-instance;
 * si algún día hay varias réplicas, habría que moverlo a la BD o a Redis.
 */

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const globalForRateLimit = globalThis as unknown as {
  loginAttempts: Map<string, number[]> | undefined;
};
const attempts = (globalForRateLimit.loginAttempts ??= new Map());

function prune(key: string): number[] {
  const now = Date.now();
  const fresh = (attempts.get(key) ?? []).filter((t: number) => now - t < WINDOW_MS);
  if (fresh.length === 0) attempts.delete(key);
  else attempts.set(key, fresh);
  // Limpieza perezosa global para que el Map no crezca sin límite.
  if (attempts.size > 10_000) {
    for (const k of attempts.keys()) {
      if ((attempts.get(k) ?? []).every((t: number) => now - t >= WINDOW_MS)) attempts.delete(k);
    }
  }
  return fresh;
}

export function isLoginBlocked(ip: string, email: string): boolean {
  return prune(`${ip}|${email}`).length >= MAX_ATTEMPTS;
}

export function registerLoginFailure(ip: string, email: string) {
  const key = `${ip}|${email}`;
  attempts.set(key, [...prune(key), Date.now()]);
}

export function clearLoginFailures(ip: string, email: string) {
  attempts.delete(`${ip}|${email}`);
}

/**
 * Nº de proxies de CONFIANZA delante de la app (`TRUSTED_PROXY_HOPS`).
 * Se lee en cada llamada (es una lectura de env, no cuesta nada) para que el
 * valor se pueda cambiar sin reconstruir el módulo.
 *
 *   1 (por defecto) → un único reverse proxy (Traefik/Nginx/Easypanel).
 *   0               → la app está expuesta directamente: `X-Forwarded-For` no
 *                     es de fiar y se ignora entera.
 *   N               → N proxies encadenados (p. ej. CDN + reverse proxy).
 */
function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/** IPv4 (con puerto opcional) o IPv6 (con o sin corchetes). Nada más. */
function normalizeIp(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  // [2001:db8::1]:443 → 2001:db8::1
  const bracket = v.match(/^\[([0-9a-fA-F:.]+)\](?::\d+)?$/);
  if (bracket) v = bracket[1];
  // 198.51.100.7:443 → 198.51.100.7 (un solo ':' ⇒ no es IPv6)
  else if (v.includes(":") && v.indexOf(":") === v.lastIndexOf(":") && v.includes(".")) {
    v = v.slice(0, v.indexOf(":"));
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split(".").every((o) => Number(o) <= 255) ? v : null;
  }
  if (/^[0-9a-fA-F:]+$/.test(v) && v.includes(":")) return v.toLowerCase();
  return null;
}

/**
 * IP del cliente para la clave del rate-limit.
 *
 * `X-Forwarded-For` la escribe el propio cliente: si cogemos el primer valor
 * (lo que se hacía antes) basta con mandar una IP distinta en cada intento
 * para que la clave cambie siempre y el límite no bloquee nunca. Lo único que
 * no puede falsificar es lo que AÑADE el proxy, así que contamos desde la
 * DERECHA tantos saltos como proxies de confianza haya configurados.
 *
 * Si la cabecera no trae suficientes saltos, o el valor no es una IP, no nos
 * inventamos nada: devolvemos "unknown", que agrupa esos intentos bajo una
 * única clave (siguen limitados, nunca ilimitados).
 */
export function clientIpFrom(req: Request | undefined): string {
  const hops = trustedProxyHops();
  if (hops === 0) return "unknown"; // sin proxy de confianza no hay cabecera creíble

  const fwd = req?.headers?.get?.("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",");
    // El salto nº `hops` contando desde el final es el que escribió el proxy
    // de confianza más externo; todo lo que quede a su izquierda es del cliente.
    const candidate = parts.length >= hops ? parts[parts.length - hops] : undefined;
    return candidate ? (normalizeIp(candidate) ?? "unknown") : "unknown";
  }

  // Sin XFF, `x-real-ip` la pone el mismo proxy de confianza (la sobreescribe,
  // no la concatena), así que vale como respaldo.
  const real = req?.headers?.get?.("x-real-ip");
  return real ? (normalizeIp(real) ?? "unknown") : "unknown";
}
