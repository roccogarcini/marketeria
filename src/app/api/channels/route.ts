import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, POST editor
const createSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(["LINKEDIN", "BLOG", "NEWSLETTER", "INSTAGRAM", "TWITTER", "CAROUSEL", "CUSTOM"]),
  constraintsJson: z.string().max(4000).optional().nullable(),
  templateMarkdown: z.string().max(20_000).optional().nullable(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const channels = await prisma.channel.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ channels });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const channel = await prisma.channel.create({ data: parsed.data });
  return NextResponse.json({ channel }, { status: 201 });
}
