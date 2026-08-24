import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";

// Política: GET any, POST editor
// POST crea Content desde una Idea APPROVED. Llama al router IA con BrandProfile.
const createSchema = z.object({
  ideaId: z.string().min(1).max(128),
});

export async function GET(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") ?? undefined;
  const contents = await prisma.content.findMany({
    where: { ...(status ? { status } : {}) },
    orderBy: { updatedAt: "desc" },
    include: {
      idea: { select: { id: true, title: true } },
      _count: { select: { versions: true, assets: true } },
    },
  });
  return NextResponse.json({ contents });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const idea = await prisma.idea.findUnique({ where: { id: parsed.data.ideaId } });
  if (!idea) return NextResponse.json({ error: "Idea no encontrada" }, { status: 404 });
  if (idea.status !== "APPROVED") {
    return NextResponse.json({ error: "La idea debe estar APPROVED para producir contenido" }, { status: 409 });
  }

  const brand = await prisma.brandProfile.findUnique({ where: { id: "default" } });
  const brandBlock = brand
    ? [
        `Marca: ${brand.name}`,
        brand.tone && `Tono: ${brand.tone}`,
        brand.voice && `Voz: ${brand.voice}`,
        brand.audience && `Audiencia: ${brand.audience}`,
        brand.editorialLinesJson && `Líneas editoriales: ${brand.editorialLinesJson}`,
        brand.mustAvoid && `Evitar: ${brand.mustAvoid}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const systemPrompt = [
    "Eres un redactor editorial senior. Produces contenido markdown listo para editar.",
    brandBlock && "Perfil de marca que debes respetar:\n" + brandBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `# ${idea.title}`,
    idea.angle && `Ángulo: ${idea.angle}`,
    idea.rationale && `Rationale: ${idea.rationale}`,
    "",
    "Escribe el contenido completo en Markdown. Empieza con un H1.",
  ]
    .filter(Boolean)
    .join("\n");

  const result = await execute(guard.user.id, {
    phase: "PRODUCTION",
    refType: "idea",
    refId: idea.id,
    systemPrompt,
    userPrompt,
  });

  if (result.status === "ERROR") {
    return NextResponse.json({ error: result.error ?? "Error IA" }, { status: 500 });
  }

  const body = result.output.trim();
  const firstHeading = body.match(/^#\s+(.+)$/m);
  const title = firstHeading ? firstHeading[1].slice(0, 300) : idea.title;

  const content = await prisma.content.create({
    data: {
      ideaId: idea.id,
      title,
      body,
      status: "DRAFT",
      currentVersion: 1,
      createdById: guard.user.id,
      versions: {
        create: [
          {
            version: 1,
            body,
            notes: "Versión inicial generada por IA",
            isMilestone: true,
            createdById: guard.user.id,
          },
        ],
      },
    },
    include: { versions: true },
  });

  return NextResponse.json({ content, result }, { status: 201 });
}
