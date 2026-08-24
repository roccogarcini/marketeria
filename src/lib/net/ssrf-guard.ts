import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Guard anti-SSRF para fetchers que reciben URLs del usuario (fuentes URL/RSS).
 * Solo http/https y hosts que no resuelvan a rangos privados, loopback,
 * link-local o metadata de cloud. Riesgo residual aceptado: DNS rebinding
 * TOCTOU (mitigarlo requiere pinnear la IP en el connect de undici).
 */

export class SsrfError extends Error {}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(
    ([base, bits]) => n >>> (32 - bits) === ipv4ToInt(base) >>> (32 - bits),
  );
}

function isPrivateIPv6(raw: string): boolean {
  const ip = raw.toLowerCase();
  if (ip === "::" || ip === "::1") return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  if (ip.startsWith("::ffff:")) return true; // mapped en forma hex — bloquear por precaución
  // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (site-local), ff00::/8 (multicast)
  return /^(f[cd]|fe[89ab]|fec|ff)/.test(ip) || ip.startsWith("2001:db8");
}

export function isPrivateAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateIPv4(ip);
  if (version === 6) return isPrivateIPv6(ip);
  return true; // no es una IP → bloquear
}

/** Valida esquema y resuelve DNS rechazando IPs privadas. Devuelve la URL parseada. */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl); // lanza TypeError si es inválida
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SsrfError(`Protocolo no permitido: ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // literales IPv6 llegan con corchetes
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new SsrfError(`IP no pública: ${host}`);
    return url;
  }
  const addrs = await lookup(host, { all: true });
  if (addrs.length === 0) throw new SsrfError(`DNS sin resultados: ${host}`);
  for (const a of addrs) {
    if (isPrivateAddress(a.address)) {
      throw new SsrfError(`${host} resuelve a una IP privada`);
    }
  }
  return url;
}
