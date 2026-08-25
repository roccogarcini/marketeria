import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/hash";

// Política: admin
const patchSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    role: z.enum(["ADMIN", "EDITOR", "VIEWER"]).optional(),
    isActive: z.boolean().optional(),
    password: z.string().min(8).max(128).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.password) {
    data.hashedPassword = await hashPassword(parsed.data.password);
    delete data.password;
  }

  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Salvaguarda: no permitir desactivar/downgrade al último ADMIN
  if (parsed.data.role !== undefined || parsed.data.isActive === false) {
    const willBeAdmin = parsed.data.role ? parsed.data.role === "ADMIN" : existing.role === "ADMIN";
    const willBeActive =
      parsed.data.isActive !== undefined ? parsed.data.isActive : existing.isActive;
    if (existing.role === "ADMIN" && !(willBeAdmin && willBeActive)) {
      const adminCount = await prisma.user.count({
        where: { role: "ADMIN", isActive: true, deletedAt: null },
      });
      if (adminCount <= 1) {
        return NextResponse.json(
          { error: "No se puede quedar sin administradores activos" },
          { status: 409 },
        );
      }
    }
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      createdAt: true,
      lastLoginAt: true,
    },
  });
  return NextResponse.json({ user });
}

/**
 * DELETE = borrado LÓGICO (soft-delete). Decisión: el histórico del usuario
 * (contenidos, ideas, versiones, comentarios, actividades y ejecuciones IA)
 * NO se pierde — las FK createdById/userId siguen apuntando a la fila, así
 * que no hay cascadas ni registros huérfanos. Lo único que se destruye son
 * sus credenciales y accesos: proveedores LLM (claves cifradas), API keys
 * externas, tokens de reset y process configs. El email se anonimiza para
 * liberar el UNIQUE (permite dar de alta a la misma persona más adelante) y
 * la contraseña se sustituye por una aleatoria imposible de usar.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (id === guard.user.id) {
    return NextResponse.json({ error: "No puedes borrarte a ti mismo" }, { status: 409 });
  }
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (existing.role === "ADMIN") {
    const adminCount = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, deletedAt: null },
    });
    if (adminCount <= 1) {
      return NextResponse.json(
        { error: "No se puede borrar el último administrador" },
        { status: 409 },
      );
    }
  }

  const anonymizedEmail = `eliminado-${id.slice(0, 8)}@usuarios.marketeria.local`;
  const unusablePassword = await hashPassword(randomBytes(32).toString("hex"));

  await prisma.$transaction([
    // Credenciales y accesos: fuera.
    prisma.passwordResetToken.deleteMany({ where: { userId: id } }),
    prisma.apiKey.deleteMany({ where: { createdById: id } }),
    prisma.processConfig.deleteMany({ where: { userId: id } }),
    prisma.lLMProvider.deleteMany({ where: { userId: id } }),
    // La fila se queda (histórico intacto), marcada como eliminada.
    prisma.user.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
        email: anonymizedEmail,
        hashedPassword: unusablePassword,
      },
    }),
  ]);
  return NextResponse.json({ ok: true });
}
