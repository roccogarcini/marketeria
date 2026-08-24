import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, PATCH editor
const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().max(200_000).optional(),
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"]).optional(),
  notes: z.string().max(2000).optional(),
  isMilestone: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const content = await prisma.content.findUnique({
    where: { id },
    include: {
      idea: { select: { id: true, title: true, status: true } },
      versions: { orderBy: { version: "desc" } },
      assets: { include: { channel: { select: { id: true, name: true, type: true } } } },
    },
  });
  if (!content) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ content });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const existing = await prisma.content.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.status !== undefined) data.status = parsed.data.status;

  // Si cambia el body, se crea una nueva versión y se incrementa currentVersion
  let newVersion: number | null = null;
  if (parsed.data.body !== undefined && parsed.data.body !== existing.body) {
    newVersion = existing.currentVersion + 1;
    data.body = parsed.data.body;
    data.currentVersion = newVersion;
  }

  const content = await prisma.content.update({
    where: { id },
    data,
  });

  if (newVersion !== null) {
    await prisma.contentVersion.create({
      data: {
        contentId: id,
        version: newVersion,
        body: parsed.data.body!,
        notes: parsed.data.notes ?? null,
        isMilestone: parsed.data.isMilestone ?? false,
        createdById: guard.user.id,
      },
    });
  }

  return NextResponse.json({ content });
}
