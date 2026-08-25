import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Configuración del webhook de WhatsApp — Nivel 3 (panel admin, secretos
 * cifrados en la base de datos).
 *
 * Vive en AppSetting y NO en LLMProvider, que es por usuario: a este webhook
 * lo llama Meta, sin sesión y sin usuario al que atribuirlo. Es configuración
 * de la instalación, no de una persona.
 */

const KEYS = {
  enabled: "whatsapp_enabled",
  verifyToken: "whatsapp_verify_token", // cifrado
  appSecret: "whatsapp_app_secret", // cifrado
  sourceId: "whatsapp_source_id",
} as const;

export const WHATSAPP_SETTING_KEYS: string[] = Object.values(KEYS);

export type WhatsAppConfig = {
  enabled: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  sourceId: string | null;
};

/** Config para la UI: dice SI hay secretos, nunca cuáles. */
export async function getWhatsAppConfig(): Promise<WhatsAppConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: WHATSAPP_SETTING_KEYS } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: byKey.get(KEYS.enabled) === "true",
    hasVerifyToken: Boolean(byKey.get(KEYS.verifyToken)),
    hasAppSecret: Boolean(byKey.get(KEYS.appSecret)),
    sourceId: byKey.get(KEYS.sourceId) || null,
  };
}

async function leerSecreto(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row?.value) return null;
  try {
    return decrypt(row.value);
  } catch {
    // Pasa si ENCRYPTION_KEY cambió después de guardarlo. Devolver null hace
    // que el webhook falle cerrado, que es lo que toca.
    return null;
  }
}

export const getVerifyToken = () => leerSecreto(KEYS.verifyToken);
export const getAppSecret = () => leerSecreto(KEYS.appSecret);

/** Id de la Source que recibe los mensajes. null si aún no se ha elegido. */
export async function getSourceId(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEYS.sourceId } });
  return row?.value || null;
}

async function guardar(key: string, value: string, category = "integrations") {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value, category },
    create: { key, value, category },
  });
}

/**
 * Guarda la configuración. Los secretos solo se pisan si vienen con valor:
 * la UI manda el campo vacío cuando no se ha tocado, y un vacío no puede
 * borrar un token que funciona.
 */
export async function saveWhatsAppConfig(input: {
  enabled: boolean;
  verifyToken?: string | null;
  appSecret?: string | null;
  sourceId?: string | null;
}): Promise<void> {
  await guardar(KEYS.enabled, input.enabled ? "true" : "false");
  if (input.verifyToken) await guardar(KEYS.verifyToken, encrypt(input.verifyToken));
  if (input.appSecret) await guardar(KEYS.appSecret, encrypt(input.appSecret));
  if (input.sourceId !== undefined) await guardar(KEYS.sourceId, input.sourceId ?? "");
}

/** Borra un secreto (para rotarlo desde cero). */
export async function clearWhatsAppSecret(cual: "verifyToken" | "appSecret"): Promise<void> {
  await prisma.appSetting
    .delete({ where: { key: cual === "verifyToken" ? KEYS.verifyToken : KEYS.appSecret } })
    .catch(() => {
      /* no estaba: nada que borrar */
    });
}
