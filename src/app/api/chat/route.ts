import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: any. Lista sesiones del usuario y permite crear una nueva.
const createSchema = z.object({ title: z.string().max(200).optional() });

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const sessions = await prisma.chatSession.findMany({
    where: { userId: guard.user.id },
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true } } },
    take: 50,
  });
  return NextResponse.json({ sessions });
}

export async function POST(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const session = await prisma.chatSession.create({
    data: {
      userId: guard.user.id,
      title: parsed.data.title ?? "Nueva conversación",
    },
  });
  return NextResponse.json({ session }, { status: 201 });
}
