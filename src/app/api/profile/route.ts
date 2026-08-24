import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/auth/hash";

/**
 * PATCH /api/profile — edición del propio perfil (cualquier rol).
 * Cambiar email o contraseña exige la contraseña actual. El cliente debe
 * forzar re-login tras esos cambios (el JWT lleva el email antiguo).
 */
const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    email: z.string().email().max(200).optional(),
    currentPassword: z.string().max(128).optional(),
    newPassword: z.string().min(8).max(128).optional(),
  })
  .refine((v) => v.name || v.email || v.newPassword, { message: "empty update" });

export async function PATCH(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: guard.user.id } });
  if (!user) return NextResponse.json({ error: "Usuario no encontrado" }, { status: 404 });

  const email = parsed.data.email?.trim().toLowerCase();
  const emailChanged = !!email && email !== user.email;
  const passwordChanged = !!parsed.data.newPassword;

  // Cambios sensibles: verificar identidad con la contraseña actual.
  if (emailChanged || passwordChanged) {
    if (!parsed.data.currentPassword) {
      return NextResponse.json(
        { error: "Introduce tu contraseña actual para cambiar email o contraseña" },
        { status: 400 },
      );
    }
    const valid = await verifyPassword(parsed.data.currentPassword, user.hashedPassword);
    if (!valid) {
      return NextResponse.json({ error: "Contraseña actual incorrecta" }, { status: 403 });
    }
  }

  if (emailChanged) {
    const taken = await prisma.user.findUnique({ where: { email } });
    if (taken && taken.id !== user.id) {
      return NextResponse.json({ error: "Ese email ya está en uso" }, { status: 409 });
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name && parsed.data.name !== user.name) data.name = parsed.data.name;
  if (emailChanged) data.email = email;
  if (passwordChanged) data.hashedPassword = await hashPassword(parsed.data.newPassword!);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ ok: true, requiresRelogin: false });
  }

  await prisma.user.update({ where: { id: user.id }, data });

  // Email/contraseña viven en las credenciales de login → re-login obligado.
  return NextResponse.json({ ok: true, requiresRelogin: emailChanged || passwordChanged });
}
