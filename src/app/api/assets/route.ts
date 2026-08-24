import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";

// Política: GET any, POST editor
// POST adapta un Content APROBADO a un Channel concreto, generando un Asset.
const adaptSchema = z.object({
  contentId: z.string().min(1).max(128),
  channelId: z.string().min(1).max(128),
});

export async function GET(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { searchParams } = new URL(req.url);
  const contentId = searchParams.get("contentId") ?? undefined;
  const assets = await prisma.asset.findMany({
    where: { ...(contentId ? { contentId } : {}) },
    orderBy: { updatedAt: "desc" },
    include: {
      channel: { select: { id: true, name: true, type: true } },
      content: { select: { id: true, title: true, status: true } },
    },
  });
  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = adaptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const [content, channel] = await Promise.all([
    prisma.content.findUnique({ where: { id: parsed.data.contentId } }),
    prisma.channel.findUnique({ where: { id: parsed.data.channelId } }),
  ]);
  if (!content) return NextResponse.json({ error: "Content no encontrado" }, { status: 404 });
  if (!channel) return NextResponse.json({ error: "Channel no encontrado" }, { status: 404 });
  if (content.status !== "APPROVED") {
    return NextResponse.json(
      { error: "El contenido debe estar APPROVED para generar assets" },
      { status: 409 },
    );
  }

  const existing = await prisma.asset.findUnique({
    where: { contentId_channelId: { contentId: content.id, channelId: channel.id } },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Ya existe un asset para este contenido/canal" },
      { status: 409 },
    );
  }

  const systemPrompt = [
    "Eres un redactor que adapta contenido a un canal concreto.",
    `Canal: ${channel.name} (${channel.type})`,
    channel.constraintsJson && `Restricciones: ${channel.constraintsJson}`,
    channel.templateMarkdown && `Plantilla de referencia:\n${channel.templateMarkdown}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userPrompt = [
    `Contenido original:\n# ${content.title}\n\n${content.body}`,
    "",
    `Adapta al canal ${channel.type}. Devuelve SOLO el markdown adaptado, sin explicaciones.`,
  ].join("\n");

  const result = await execute(guard.user.id, {
    phase: "ASSET",
    refType: "asset",
    refId: `${content.id}:${channel.id}`,
    systemPrompt,
    userPrompt,
  });

  if (result.status === "ERROR") {
    return NextResponse.json({ error: result.error ?? "Error IA" }, { status: 500 });
  }

  const asset = await prisma.asset.create({
    data: {
      contentId: content.id,
      channelId: channel.id,
      body: result.output.trim(),
      status: "READY",
      aiExecutionMode: result.mode,
    },
    include: { channel: true },
  });

  return NextResponse.json({ asset, result }, { status: 201 });
}
