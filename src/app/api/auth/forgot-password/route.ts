import { NextResponse } from "next/server";
import { z } from "zod";
import { headers } from "next/headers";
import { createResetToken } from "@/lib/auth/password-reset";
import { isSmtpConfigured, sendMail } from "@/lib/mail/smtp";
import { clientIpFrom, isLoginBlocked, registerLoginFailure } from "@/lib/auth/rate-limit";

/**
 * POST /api/auth/forgot-password  { email }
 *
 * Envía (si procede) un email con el enlace de reseteo. SIEMPRE responde 200
 * genérico para no revelar si el email existe. Pública (flujo /api/auth/*).
 */
const schema = z.object({ email: z.string().email().max(200) });

async function baseUrl(): Promise<string> {
  const env = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  // Respuesta genérica también ante payload inválido (no filtrar nada).
  const generic = NextResponse.json({
    ok: true,
    message: "Si el email existe, te hemos enviado un enlace para restablecer la contraseña.",
  });
  if (!parsed.success) return generic;

  const email = parsed.data.email.trim().toLowerCase();
  const ip = clientIpFrom(req);
  // Reutilizamos el rate-limit de login (IP+email) para frenar el abuso.
  if (isLoginBlocked(ip, `forgot:${email}`)) return generic;
  registerLoginFailure(ip, `forgot:${email}`);

  if (!(await isSmtpConfigured())) {
    // Sin SMTP no podemos enviar; devolvemos genérico igualmente pero lo
    // registramos para el admin en logs.
    console.warn("[forgot-password] SMTP no configurado; no se envió email.");
    return generic;
  }

  const created = await createResetToken(email);
  if (created) {
    const link = `${await baseUrl()}/reset-password?token=${created.token}`;
    const html = `
      <p>Hola ${created.user.name || ""},</p>
      <p>Has solicitado restablecer tu contraseña en Marketería. Pulsa el enlace (válido 1 hora):</p>
      <p><a href="${link}">Restablecer mi contraseña</a></p>
      <p>Si no fuiste tú, ignora este correo.</p>
    `;
    try {
      await sendMail(
        created.user.email,
        "Restablecer tu contraseña — Marketería",
        html,
        `Restablece tu contraseña: ${link}`,
      );
    } catch (err) {
      console.error("[forgot-password] fallo al enviar email:", err);
    }
  }
  return generic;
}
