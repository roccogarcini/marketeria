import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, PATCH editor, DELETE editor
const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  angle: z.string().max(500).nullable().optional(),
  rationale: z.string().max(20_000).nullable().optional(),
  feedback: z.string().max(4000).nullable().optional(),
  referenceUrl: z.string().max(1000).nullable().optional(),
  viralityScore: z.number().min(0).max(1).nullable().optional(),
  potentialScore: z.number().min(0).max(1).nullable().optional(),
  idealFormat: z.string().max(120).nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const idea = await prisma.idea.findUnique({
    where: { id },
    include: {
      comments: {
        orderBy: { createdAt: "asc" },
        include: { user: { select: { id: true, name: true } } },
      },
      createdBy: { select: { id: true, name: true } },
      decidedBy: { select: { id: true, name: true } },
      insight: { select: { id: true, title: true } },
    },
  });
  if (!idea) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ idea });
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
  // Validación opcional: si viene referenceUrl como string no vacío, exigir URL válida.
  if (parsed.data.referenceUrl && parsed.data.referenceUrl.length > 0) {
    try {
      new URL(parsed.data.referenceUrl);
    } catch {
      return NextResponse.json({ error: "referenceUrl no es una URL válida" }, { status: 400 });
    }
  }
  const idea = await prisma.idea.update({ where: { id }, data: parsed.data });
  return NextResponse.json({ idea });
}

/**
 * DELETE /api/ideas/[id]
 *
 * Borra la idea y, en cascada vía Prisma:
 *   IdeaComment, Content (→ ContentVersion, Asset).
 *
 * El borrado se permite en cualquier estado de la idea — la UI debe pedir
 * confirmación cuando la idea tiene contenidos producidos. Devolvemos
 * en la respuesta los contadores de lo que se borró para que la UI pueda
 * mostrar feedback claro al editor.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const idea = await prisma.idea.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      _count: { select: { contents: true, comments: true } },
    },
  });
  if (!idea) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.idea.delete({ where: { id } });

  await prisma.activity.create({
    data: {
      userId: guard.user.id,
      entityType: "idea",
      entityId: id,
      action: "delete",
      metaJson: JSON.stringify({
        title: idea.title,
        cascadedContents: idea._count.contents,
        cascadedComments: idea._count.comments,
      }),
    },
  });

  return NextResponse.json({
    deletedId: id,
    cascadedContents: idea._count.contents,
    cascadedComments: idea._count.comments,
  });
}
