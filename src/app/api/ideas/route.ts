import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, POST editor
const createSchema = z.object({
  title: z.string().min(1).max(300),
  angle: z.string().max(500).optional().nullable(),
  rationale: z.string().max(20_000).optional().nullable(),
  insightId: z.string().min(1).max(128).optional().nullable(),
  referenceUrl: z.string().url().max(1000).optional().nullable(),
  viralityScore: z.number().min(0).max(1).optional().nullable(),
  potentialScore: z.number().min(0).max(1).optional().nullable(),
  idealFormat: z.string().max(120).optional().nullable(),
  status: z.enum(["DRAFT", "PROPOSED", "APPROVED"]).optional(),
});

export async function GET(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const ideas = await prisma.idea.findMany({
    where: { ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      _count: { select: { comments: true, contents: true } },
    },
  });
  return NextResponse.json({ ideas });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const idea = await prisma.idea.create({
    data: {
      title: parsed.data.title,
      angle: parsed.data.angle ?? null,
      rationale: parsed.data.rationale ?? null,
      insightId: parsed.data.insightId ?? null,
      referenceUrl: parsed.data.referenceUrl ?? null,
      viralityScore: parsed.data.viralityScore ?? null,
      potentialScore: parsed.data.potentialScore ?? null,
      idealFormat: parsed.data.idealFormat ?? null,
      // Por defecto idea manual → APPROVED (en flujo simplificado de 3 fases).
      status: parsed.data.status ?? "APPROVED",
      createdById: guard.user.id,
      decidedById: (parsed.data.status ?? "APPROVED") === "APPROVED" ? guard.user.id : null,
      decidedAt: (parsed.data.status ?? "APPROVED") === "APPROVED" ? new Date() : null,
    },
  });
  return NextResponse.json({ idea }, { status: 201 });
}
