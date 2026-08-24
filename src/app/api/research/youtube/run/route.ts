import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  getYouTubeApiKey,
  searchYouTubeVideos,
  normalizeYouTubeVideo,
} from "@/lib/youtube/client";
import { createFindingIfNew } from "@/lib/research/findings";

/**
 * POST /api/research/youtube/run
 *
 * Lanzamiento ad-hoc YouTube Data API. Busca vídeos por query, enriquece con
 * stats (viewCount, likeCount, commentCount) y crea Findings con dedupe.
 */
const bodySchema = z.object({
  sourceId: z.string().min(1).max(128),
  query: z.string().min(2).max(500),
  maxItems: z.number().int().min(1).max(50).optional().default(30),
  order: z.enum(["relevance", "date", "rating", "viewCount"]).optional().default("relevance"),
  daysBack: z.number().int().min(0).max(365).optional().default(0),
});

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const source = await prisma.source.findUnique({
    where: { id: parsed.data.sourceId },
    select: { id: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source no encontrada" }, { status: 404 });
  }

  const apiKey = await getYouTubeApiKey(guard.user.id);
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          "API key de YouTube no configurada. Añádela en /admin/proveedores con tipo YOUTUBE.",
      },
      { status: 409 },
    );
  }

  let videos: Awaited<ReturnType<typeof searchYouTubeVideos>> = [];
  try {
    videos = await searchYouTubeVideos(apiKey, {
      query: parsed.data.query,
      maxResults: parsed.data.maxItems,
      order: parsed.data.order,
      publishedAfter:
        parsed.data.daysBack && parsed.data.daysBack > 0
          ? new Date(Date.now() - parsed.data.daysBack * 24 * 3600 * 1000)
          : undefined,
    });
  } catch (err) {
    console.error("[research/youtube]:", err);
    return NextResponse.json(
      // Host fijo (googleapis): mensaje de la API (cuota, clave), accionable; truncado.
      { error: err instanceof Error ? err.message.slice(0, 200) : "Error YouTube" },
      { status: 502 },
    );
  }

  let created = 0;
  let skipped = 0;
  let errorsCount = 0;
  for (const v of videos) {
    const mapped = normalizeYouTubeVideo(v);
    if (!mapped) {
      errorsCount++;
      continue;
    }
    const isNew = await createFindingIfNew({
      sourceId: source.id,
      title: mapped.title,
      url: mapped.url,
      snippet: mapped.snippet,
      summary: mapped.summary,
      author: mapped.author,
      publishedAt: mapped.publishedAt,
      reach: mapped.reach,
      likes: mapped.likes,
      comments: mapped.comments,
      shares: null,
      status: "NEW",
    });
    if (isNew) created++;
    else skipped++;
  }

  await prisma.source.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date() },
  });

  return NextResponse.json({ created, skipped, errorsCount });
}
