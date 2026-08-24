import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";

// Política: editor
const schema = z.object({
  instructions: z.string().max(4000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const content = await prisma.content.findUnique({
    where: { id },
    include: { idea: true },
  });
  if (!content) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const brand = await prisma.brandProfile.findUnique({ where: { id: "default" } });

  const systemPrompt = [
    "Eres un redactor editorial. Reescribe el contenido aplicando las instrucciones.",
    brand &&
      `Perfil de marca:\n${brand.name}\nTono: ${brand.tone ?? "—"}\nVoz: ${brand.voice ?? "—"}\nAudiencia: ${brand.audience ?? "—"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `Idea de origen: ${content.idea.title}`,
    parsed.data.instructions && `\nInstrucciones: ${parsed.data.instructions}`,
    "\nVersión actual:",
    content.body,
  ].join("\n");

  const result = await execute(guard.user.id, {
    phase: "PRODUCTION",
    refType: "content",
    refId: content.id,
    systemPrompt,
    userPrompt,
  });

  if (result.status === "ERROR") {
    return NextResponse.json({ error: result.error ?? "Error IA" }, { status: 500 });
  }

  const newBody = result.output.trim();
  const newVersion = content.currentVersion + 1;

  const updated = await prisma.content.update({
    where: { id },
    data: {
      body: newBody,
      currentVersion: newVersion,
    },
  });

  await prisma.contentVersion.create({
    data: {
      contentId: id,
      version: newVersion,
      body: newBody,
      notes: parsed.data.instructions ? `Regenerado: ${parsed.data.instructions}` : "Regenerado",
      isMilestone: false,
      createdById: guard.user.id,
    },
  });

  return NextResponse.json({ content: updated, result }, { status: 201 });
}
