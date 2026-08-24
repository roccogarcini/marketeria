import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, PATCH editor
const patchSchema = z.object({
  status: z.enum(["NEW", "DISCARDED", "SENT_TO_ANALYSIS"]).optional(),
  tagsJson: z.string().max(4000).nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const finding = await prisma.finding.findUnique({
    where: { id },
    include: { source: true },
  });
  if (!finding) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ finding });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const finding = await prisma.finding.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ finding });
}
