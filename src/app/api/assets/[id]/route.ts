import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: editor
const patchSchema = z.object({
  body: z.string().max(50_000).optional(),
  status: z.enum(["PENDING", "READY", "SCHEDULED", "PUBLISHED"]).optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const data: Record<string, unknown> = { ...parsed.data };
  if (typeof parsed.data.scheduledAt === "string") {
    data.scheduledAt = new Date(parsed.data.scheduledAt);
  }
  const asset = await prisma.asset.update({ where: { id }, data });
  return NextResponse.json({ asset });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.asset.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
