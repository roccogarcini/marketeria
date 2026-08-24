import test, { before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * El rate-limit de login no se evade rotando `X-Forwarded-For`.
 *
 * El PRIMER valor de la cabecera es exactamente el trozo que escribe el
 * cliente: si `clientIpFrom` lo usara, bastaría con mandar una IP distinta en
 * cada intento para que la clave del rate-limit (`ip|email`) cambiase siempre
 * y el contador nunca llegase a 5. Fuerza bruta sin límite.
 *
 * Lo único fiable es lo que AÑADE el proxy de confianza: el valor que está a
 * `TRUSTED_PROXY_HOPS` posiciones desde la DERECHA.
 */

let clientIpFrom: typeof import("@/lib/auth/rate-limit").clientIpFrom;
let isLoginBlocked: typeof import("@/lib/auth/rate-limit").isLoginBlocked;
let registerLoginFailure: typeof import("@/lib/auth/rate-limit").registerLoginFailure;
let clearLoginFailures: typeof import("@/lib/auth/rate-limit").clearLoginFailures;

before(async () => {
  ({ clientIpFrom, isLoginBlocked, registerLoginFailure, clearLoginFailures } = await import(
    "@/lib/auth/rate-limit"
  ));
});

const envBefore = process.env.TRUSTED_PROXY_HOPS;

beforeEach(() => {
  (globalThis as { loginAttempts?: Map<string, number[]> }).loginAttempts?.clear();
  process.env.TRUSTED_PROXY_HOPS = "1";
});

afterEach(() => {
  if (envBefore === undefined) delete process.env.TRUSTED_PROXY_HOPS;
  else process.env.TRUSTED_PROXY_HOPS = envBefore;
});

/** Petición como la ve la app detrás de UN proxy: el proxy añade la IP real al final. */
function reqBehindProxy(spoofed: string | null, realIp: string): Request {
  const xff = spoofed ? `${spoofed}, ${realIp}` : realIp;
  return new Request("https://spaider.test/api/auth/callback/credentials", {
    headers: { "x-forwarded-for": xff },
  });
}

test("rotar X-Forwarded-For no cambia la IP: el atacante sigue bloqueado a los 5 intentos", () => {
  const email = "admin@spaider.test";
  const REAL = "198.51.100.7";

  for (let i = 0; i < 5; i++) {
    // Cada intento con una IP falsificada distinta en la parte que controla él.
    const ip = clientIpFrom(reqBehindProxy(`10.0.0.${i}`, REAL));
    assert.equal(isLoginBlocked(ip, email), false, `bloqueado antes de tiempo en el intento ${i}`);
    registerLoginFailure(ip, email);
  }

  const sexto = clientIpFrom(reqBehindProxy("10.0.0.99", REAL));
  assert.equal(
    isLoginBlocked(sexto, email),
    true,
    "el sexto intento con otra X-Forwarded-For debería estar bloqueado",
  );
});

test("clientIpFrom devuelve el valor que añade el proxy, no el del cliente", () => {
  assert.equal(clientIpFrom(reqBehindProxy("1.2.3.4", "198.51.100.7")), "198.51.100.7");
  assert.equal(clientIpFrom(reqBehindProxy(null, "198.51.100.7")), "198.51.100.7");
});

test("con TRUSTED_PROXY_HOPS=2 se salta el último salto (dos proxies encadenados)", () => {
  process.env.TRUSTED_PROXY_HOPS = "2";
  const req = new Request("https://spaider.test/", {
    headers: { "x-forwarded-for": "1.2.3.4, 198.51.100.7, 10.10.0.1" },
  });
  assert.equal(clientIpFrom(req), "198.51.100.7");
});

test("con TRUSTED_PROXY_HOPS=0 la cabecera se ignora por completo", () => {
  process.env.TRUSTED_PROXY_HOPS = "0";
  assert.equal(clientIpFrom(reqBehindProxy("1.2.3.4", "198.51.100.7")), "unknown");
  assert.equal(
    clientIpFrom(new Request("https://spaider.test/", { headers: { "x-real-ip": "1.2.3.4" } })),
    "unknown",
  );
});

test("cabecera con menos saltos de los configurados no se cree al cliente", () => {
  process.env.TRUSTED_PROXY_HOPS = "2";
  // Solo hay un valor: lo puso el cliente, el segundo proxy no llegó a escribir.
  assert.equal(clientIpFrom(reqBehindProxy(null, "1.2.3.4")), "unknown");
});

test("un valor que no es una IP no se acepta como clave", () => {
  const req = new Request("https://spaider.test/", {
    headers: { "x-forwarded-for": "1.2.3.4, no-soy-una-ip" },
  });
  assert.equal(clientIpFrom(req), "unknown");
});

test("clearLoginFailures sigue liberando la clave tras un login correcto", () => {
  const ip = clientIpFrom(reqBehindProxy("10.0.0.1", "198.51.100.7"));
  for (let i = 0; i < 5; i++) registerLoginFailure(ip, "user@spaider.test");
  assert.equal(isLoginBlocked(ip, "user@spaider.test"), true);
  clearLoginFailures(ip, "user@spaider.test");
  assert.equal(isLoginBlocked(ip, "user@spaider.test"), false);
});
