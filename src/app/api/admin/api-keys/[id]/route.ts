import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: admin. PATCH activa/desactiva; DELETE revoca definitivamente.
const patchSchema = z.object({ isActive: z.boolean() });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const updated = await prisma.apiKey.updateMany({
    where: { id },
    data: { isActive: parsed.data.isActive },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: "Clave no encontrada" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.apiKey.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
