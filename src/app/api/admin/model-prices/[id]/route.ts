import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: admin. Elimina una tarifa de modelo.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.modelPrice.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
