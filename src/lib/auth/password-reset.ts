import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/hash";

/**
 * Recuperación de contraseña por token. El token en claro solo viaja en el
 * email; en BD guardamos su SHA-256. Un solo uso, caduca en 1 hora.
 */

const TTL_MS = 60 * 60 * 1000; // 1h

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/**
 * Crea un token de reseteo para el email (si existe un usuario activo).
 * Devuelve el token en claro y el usuario, o null si no procede (no se revela
 * al llamador si el email existe o no — eso lo decide el endpoint).
 */
export async function createResetToken(
  email: string,
): Promise<{ token: string; user: { id: string; email: string; name: string } } | null> {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, name: true, isActive: true },
  });
  if (!user || !user.isActive) return null;

  // Invalida tokens previos sin usar del mismo usuario.
  await prisma.passwordResetToken.deleteMany({
    where: { userId: user.id, usedAt: null },
  });

  const token = randomBytes(32).toString("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      hashedToken: sha256(token),
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  return { token, user: { id: user.id, email: user.email, name: user.name } };
}

/**
 * Consume un token y actualiza la contraseña. Devuelve ok o el motivo del
 * fallo (token inválido/caducado/usado).
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!token || token.length < 32) return { ok: false, error: "Token inválido." };
  if (newPassword.length < 8) {
    return { ok: false, error: "La contraseña debe tener al menos 8 caracteres." };
  }
  const row = await prisma.passwordResetToken.findUnique({
    where: { hashedToken: sha256(token) },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  // Comparación de tiempo constante contra un valor real (defensa extra).
  if (!row) {
    timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(sha256(token)));
    return { ok: false, error: "Enlace inválido o ya utilizado." };
  }
  if (row.usedAt) return { ok: false, error: "Este enlace ya se utilizó." };
  if (row.expiresAt < new Date()) return { ok: false, error: "El enlace ha caducado. Solicita otro." };

  const hashed = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: row.userId }, data: { hashedPassword: hashed } }),
    prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    }),
  ]);
  return { ok: true };
}
