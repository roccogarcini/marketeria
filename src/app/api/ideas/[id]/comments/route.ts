import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: any (cualquier autenticado puede comentar)
const schema = z.object({ body: z.string().min(1).max(4000) });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // VIEWER es solo-lectura: comentar exige EDITOR o ADMIN.
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const comment = await prisma.ideaComment.create({
    data: { ideaId: id, userId: guard.user.id, body: parsed.data.body },
    include: { user: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ comment }, { status: 201 });
}
