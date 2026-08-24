import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, POST editor
const createSchema = z.object({
  slug: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/, "slug debe ser kebab-case"),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  systemPrompt: z.string().min(1).max(20_000),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
  icon: z.string().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const agents = await prisma.agent.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ agents });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const exists = await prisma.agent.findUnique({ where: { slug: parsed.data.slug } });
  if (exists) return NextResponse.json({ error: "slug ya en uso" }, { status: 409 });
  const agent = await prisma.agent.create({
    data: {
      slug: parsed.data.slug,
      name: parsed.data.name,
      role: parsed.data.role,
      systemPrompt: parsed.data.systemPrompt,
      temperature: parsed.data.temperature ?? 0.7,
      maxTokens: parsed.data.maxTokens ?? 2000,
      icon: parsed.data.icon ?? null,
      isActive: parsed.data.isActive ?? true,
    },
  });
  return NextResponse.json({ agent }, { status: 201 });
}
