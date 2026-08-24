import { prisma } from "@/lib/prisma";
import { decrypt, encrypt, maskSecret } from "@/lib/crypto";

/**
 * Login con Google — configuración Level 3 (panel admin, cifrada en BD).
 * Guardado en AppSetting:
 *   google_auth_enabled  → "true" | "false"
 *   google_client_id     → texto plano (no es secreto)
 *   google_client_secret → AES-256-GCM
 * Política de acceso: solo emails que ya existen como usuarios activos
 * (el signIn callback de auth.ts lo aplica) — Google nunca crea cuentas.
 */

const KEYS = {
  enabled: "google_auth_enabled",
  clientId: "google_client_id",
  clientSecret: "google_client_secret",
} as const;

export const GOOGLE_SETTING_KEYS: string[] = Object.values(KEYS);

export type GoogleAuthConfig = {
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
};

// Cache in-memory (auth() corre en cada request): 60s, invalidada al guardar.
const globalForGoogleAuth = globalThis as unknown as {
  googleAuthCache: { value: GoogleAuthConfig; at: number } | undefined;
};
const CACHE_MS = 60_000;

export function clearGoogleAuthCache() {
  globalForGoogleAuth.googleAuthCache = undefined;
}

export async function getGoogleAuth(): Promise<GoogleAuthConfig> {
  const cached = globalForGoogleAuth.googleAuthCache;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const rows = await prisma.appSetting.findMany({
    where: { key: { in: GOOGLE_SETTING_KEYS } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));

  let clientSecret: string | null = null;
  const rawSecret = byKey.get(KEYS.clientSecret);
  if (rawSecret) {
    try {
      clientSecret = decrypt(rawSecret);
    } catch {
      clientSecret = null; // clave de cifrado rotada → tratar como no configurado
    }
  }

  const value: GoogleAuthConfig = {
    enabled: byKey.get(KEYS.enabled) === "true",
    clientId: byKey.get(KEYS.clientId) ?? null,
    clientSecret,
  };
  globalForGoogleAuth.googleAuthCache = { value, at: Date.now() };
  return value;
}

/** Estado para la UI de admin: nunca devuelve el secret, solo su máscara. */
export async function getGoogleAuthAdminView() {
  const cfg = await getGoogleAuth();
  return {
    enabled: cfg.enabled,
    clientId: cfg.clientId,
    clientSecretMasked: cfg.clientSecret ? maskSecret(cfg.clientSecret) : null,
  };
}

export async function saveGoogleAuth(patch: {
  enabled?: boolean;
  clientId?: string;
  clientSecret?: string;
}) {
  const upserts: Array<{ key: string; value: string }> = [];
  if (patch.enabled !== undefined) {
    upserts.push({ key: KEYS.enabled, value: patch.enabled ? "true" : "false" });
  }
  if (patch.clientId !== undefined) {
    upserts.push({ key: KEYS.clientId, value: patch.clientId.trim() });
  }
  if (patch.clientSecret !== undefined && patch.clientSecret.trim() !== "") {
    upserts.push({ key: KEYS.clientSecret, value: encrypt(patch.clientSecret.trim()) });
  }
  for (const u of upserts) {
    await prisma.appSetting.upsert({
      where: { key: u.key },
      update: { value: u.value, category: "auth" },
      create: { key: u.key, value: u.value, category: "auth" },
    });
  }
  clearGoogleAuthCache();
}
