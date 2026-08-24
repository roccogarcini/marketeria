import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { IDEA_STATUS_TRANSITIONS } from "@/lib/ideas/status";

// Política: editor (ADMIN o EDITOR)
// Las transiciones permitidas viven en @/lib/ideas/status — fuente única de
// verdad compartida con la API externa (REST /api/v1 y MCP).

const schema = z.object({
  status: z.enum(["DRAFT", "PROPOSED", "APPROVED", "REJECTED", "ARCHIVED"]),
  feedback: z.string().max(4000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const idea = await prisma.idea.findUnique({ where: { id } });
  if (!idea) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const allowed = IDEA_STATUS_TRANSITIONS[idea.status] ?? [];
  if (!allowed.includes(parsed.data.status)) {
    return NextResponse.json(
      { error: `Transición no permitida: ${idea.status} → ${parsed.data.status}` },
      { status: 409 },
    );
  }

  const updated = await prisma.idea.update({
    where: { id },
    data: {
      status: parsed.data.status,
      feedback: parsed.data.feedback ?? idea.feedback,
      decidedById: parsed.data.status === "APPROVED" || parsed.data.status === "REJECTED" ? guard.user.id : idea.decidedById,
      decidedAt: parsed.data.status === "APPROVED" || parsed.data.status === "REJECTED" ? new Date() : idea.decidedAt,
    },
  });
  return NextResponse.json({ idea: updated });
}
