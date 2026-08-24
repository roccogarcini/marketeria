import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { IdeaDetail } from "./idea-detail";
import { materialLevel, type MaterialLevel } from "@/lib/research/material";

export const dynamic = "force-dynamic";

export default async function IdeaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [idea, channels] = await Promise.all([
    prisma.idea.findUnique({
      where: { id },
      include: {
        comments: {
          orderBy: { createdAt: "asc" },
          include: { user: { select: { id: true, name: true } } },
        },
        createdBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
        insight: {
          select: {
            id: true,
            title: true,
            analysisRun: { select: { findingIdsJson: true } },
          },
        },
        contents: {
          include: {
            assets: {
              include: { channel: true },
              orderBy: { updatedAt: "desc" },
            },
          },
          orderBy: { updatedAt: "desc" },
        },
      },
    }),
    prisma.channel.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, type: true },
    }),
  ]);
  if (!idea) notFound();

  // Semáforo de materia prima: nivel del hallazgo origen de la idea (si hay
  // traza insight → analysisRun → findings). Avisa antes de producir.
  let material: { level: MaterialLevel; findingId: string; hasUrl: boolean } | null =
    null;
  const findingIdsRaw = idea.insight?.analysisRun?.findingIdsJson;
  if (findingIdsRaw) {
    try {
      const ids = (JSON.parse(findingIdsRaw) as unknown[]).filter(
        (x): x is string => typeof x === "string",
      );
      if (ids.length > 0) {
        const finding = await prisma.finding.findFirst({
          where: { id: { in: ids } },
          orderBy: { fetchedAt: "desc" },
          select: {
            id: true,
            url: true,
            fullContent: true,
            summary: true,
            snippet: true,
          },
        });
        if (finding) {
          material = {
            level: materialLevel(finding),
            findingId: finding.id,
            hasUrl: Boolean(finding.url),
          };
        }
      }
    } catch {
      /* findingIdsJson inválido — sin semáforo */
    }
  }

  // Consolidamos todos los assets existentes de todos los contents de la idea.
  const existingAssets = idea.contents.flatMap((c) =>
    c.assets.map((a) => ({
      id: a.id,
      channelId: a.channelId,
      channelName: a.channel.name,
      channelType: a.channel.type,
      status: a.status,
      body: a.body,
    })),
  );
  const channelIdsWithAsset = new Set(existingAssets.map((a) => a.channelId));

  return (
    <IdeaDetail
      idea={{
        id: idea.id,
        title: idea.title,
        angle: idea.angle,
        rationale: idea.rationale,
        status: idea.status,
        referenceUrl: idea.referenceUrl,
        viralityScore: idea.viralityScore,
        viralityReason: idea.viralityReason,
        potentialScore: idea.potentialScore,
        potentialReason: idea.potentialReason,
        idealFormat: idea.idealFormat,
        insightTitle: idea.insight?.title ?? null,
        updatedAt: idea.updatedAt.toISOString(),
        comments: idea.comments.map((c) => ({
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          userName: c.user.name,
        })),
      }}
      channels={channels.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        hasAsset: channelIdsWithAsset.has(c.id),
      }))}
      existingAssets={existingAssets}
      contents={idea.contents.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      }))}
      material={material}
    />
  );
}
