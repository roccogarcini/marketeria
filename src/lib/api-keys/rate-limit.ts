/**
 * Rate-limit in-memory de la API externa (/api/v1/** y /api/mcp), por API key.
 * Ventana deslizante simple: 120 peticiones/minuto por clave. Igual que el
 * rate-limit de login: suficiente para single-instance; con varias réplicas
 * habría que moverlo a BD/Redis.
 */

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 120;

const globalForApiRate = globalThis as unknown as {
  apiKeyHits: Map<string, number[]> | undefined;
};
const hits = (globalForApiRate.apiKeyHits ??= new Map());

/**
 * Registra una petición de la clave y devuelve si debe bloquearse.
 * `retryAfterSeconds` indica cuánto esperar cuando se excede.
 */
export function apiKeyRateCheck(keyId: string): {
  limited: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const fresh = (hits.get(keyId) ?? []).filter((t: number) => now - t < WINDOW_MS);
  if (fresh.length >= MAX_REQUESTS) {
    hits.set(keyId, fresh);
    const oldest = fresh[0] ?? now;
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)),
    };
  }
  fresh.push(now);
  hits.set(keyId, fresh);
  // Limpieza perezosa para que el Map no crezca sin límite.
  if (hits.size > 5_000) {
    for (const k of hits.keys()) {
      if ((hits.get(k) ?? []).every((t: number) => now - t >= WINDOW_MS)) hits.delete(k);
    }
  }
  return { limited: false, retryAfterSeconds: 0 };
}
