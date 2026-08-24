import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { createResetToken } from "@/lib/auth/password-reset";
import { isSmtpConfigured, sendMail } from "@/lib/mail/smtp";

/**
 * POST /api/admin/users/[id]/reset-password — el admin genera un enlace de
 * restablecimiento para un usuario. Reutiliza el mismo mecanismo de tokens
 * que "He olvidado mi contraseña" (hash SHA-256 en BD, un solo uso, caduca
 * en 1 h). El enlace se DEVUELVE al admin para que lo comparta por el canal
 * que quiera; si hay SMTP configurado, además se envía por email al usuario.
 * Política: admin.
 */

async function baseUrl(): Promise<string> {
  const env = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, isActive: true, deletedAt: true },
  });
  if (!user || user.deletedAt) {
    return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });
  }
  if (!user.isActive) {
    return NextResponse.json(
      { error: "El usuario está desactivado: actívalo antes de generar el enlace." },
      { status: 409 },
    );
  }

  const created = await createResetToken(user.email);
  if (!created) {
    return NextResponse.json(
      { error: "No se pudo generar el enlace de restablecimiento." },
      { status: 500 },
    );
  }

  const link = `${await baseUrl()}/reset-password?token=${created.token}`;

  // Envío por email: best-effort — el enlace ya se devuelve al admin.
  let emailed = false;
  if (await isSmtpConfigured()) {
    const html = `
      <p>Hola ${created.user.name || ""},</p>
      <p>Un administrador ha generado un enlace para restablecer tu contraseña en SpAIder. Pulsa el enlace (válido 1 hora):</p>
      <p><a href="${link}">Restablecer mi contraseña</a></p>
      <p>Si no lo esperabas, contacta con tu administrador.</p>
    `;
    try {
      await sendMail(
        created.user.email,
        "Restablecer tu contraseña — SpAIder",
        html,
        `Restablece tu contraseña: ${link}`,
      );
      emailed = true;
    } catch (err) {
      console.error("[admin/users/reset-password] fallo al enviar email:", err);
    }
  }

  return NextResponse.json({ link, emailed });
}
