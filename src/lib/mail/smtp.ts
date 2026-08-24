import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Configuración SMTP — Level 3 (panel admin, contraseña cifrada en BD).
 * Guardada en AppSetting. Cubre Google Workspace: apunta host a
 * `smtp-relay.gmail.com` (relay corporativo) o `smtp.gmail.com` (con
 * contraseña de aplicación). Independiente del login de Google.
 */

const KEYS = {
  enabled: "smtp_enabled",
  host: "smtp_host",
  port: "smtp_port",
  secure: "smtp_secure",
  user: "smtp_user",
  pass: "smtp_pass", // cifrada
  from: "smtp_from",
} as const;

export const SMTP_SETTING_KEYS: string[] = Object.values(KEYS);

export type SmtpConfig = {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
  from: string | null;
};

/** Config pública (sin la contraseña en claro) para la UI. */
export async function getSmtpConfig(): Promise<SmtpConfig> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: SMTP_SETTING_KEYS } },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    enabled: byKey.get(KEYS.enabled) === "true",
    host: byKey.get(KEYS.host) ?? null,
    port: Number(byKey.get(KEYS.port) ?? "587") || 587,
    secure: byKey.get(KEYS.secure) === "true",
    user: byKey.get(KEYS.user) ?? null,
    hasPassword: Boolean(byKey.get(KEYS.pass)),
    from: byKey.get(KEYS.from) ?? null,
  };
}

/** Contraseña SMTP descifrada (solo lado servidor). */
async function getSmtpPassword(): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEYS.pass } });
  if (!row?.value) return null;
  try {
    return decrypt(row.value);
  } catch {
    return null;
  }
}

export async function saveSmtpConfig(input: {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  password?: string | null; // solo se guarda si viene (no se pisa con vacío)
  from: string | null;
}): Promise<void> {
  const entries: Array<[string, string]> = [
    [KEYS.enabled, input.enabled ? "true" : "false"],
    [KEYS.host, input.host ?? ""],
    [KEYS.port, String(input.port)],
    [KEYS.secure, input.secure ? "true" : "false"],
    [KEYS.user, input.user ?? ""],
    [KEYS.from, input.from ?? ""],
  ];
  if (typeof input.password === "string" && input.password.length > 0) {
    entries.push([KEYS.pass, encrypt(input.password)]);
  }
  for (const [key, value] of entries) {
    await prisma.appSetting.upsert({
      where: { key },
      create: { key, value, category: "smtp" },
      update: { value },
    });
  }
}

/** Construye el transporter SMTP o null si no está configurado/activo. */
async function getTransport() {
  const cfg = await getSmtpConfig();
  if (!cfg.enabled || !cfg.host) return null;
  const pass = await getSmtpPassword();
  return {
    transporter: nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user && pass ? { user: cfg.user, pass } : undefined,
    }),
    from: cfg.from || cfg.user || "no-reply@spaider.local",
  };
}

export async function isSmtpConfigured(): Promise<boolean> {
  const cfg = await getSmtpConfig();
  return cfg.enabled && Boolean(cfg.host);
}

export async function sendMail(to: string, subject: string, html: string, text?: string) {
  const t = await getTransport();
  if (!t) throw new Error("SMTP no configurado. Configúralo en Admin → Ajustes.");
  await t.transporter.sendMail({ from: t.from, to, subject, html, text });
}

/** Verifica la conexión SMTP (para el botón "probar" del panel). */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  try {
    const t = await getTransport();
    if (!t) return { ok: false, error: "SMTP no activado o sin host." };
    await t.transporter.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "Error" };
  }
}
