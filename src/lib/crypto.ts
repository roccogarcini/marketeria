import crypto from "node:crypto";

/**
 * AES-256-GCM encryption/decryption para credenciales de Level 3
 * (ej. API keys de proveedores LLM).
 *
 * Formato de almacenamiento: `v1:<iv_base64>:<tag_base64>:<ciphertext_base64>`.
 * IV aleatorio de 12 bytes por registro (GCM standard). Authentication tag de 16 bytes.
 * La clave se deriva de `ENCRYPTION_KEY` (env var, Level 1) con SHA-256 a 32 bytes.
 */

const ALGO = "aes-256-gcm";
const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new Error("ENCRYPTION_KEY is missing or too short (min 32 chars).");
  }
  return crypto.createHash("sha256").update(raw).digest();
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid ciphertext format.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(
    ALGO,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}

/**
 * Devuelve una versión ofuscada de una API key para mostrar al usuario
 * en UI / logs (ej. "sk-...a7b2"). Nunca expone más de 4 chars iniciales + 4 finales.
 */
export function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}••••${secret.slice(-4)}`;
}
