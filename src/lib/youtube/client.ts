import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchWithRetry } from "@/lib/net/retry";

/**
 * Cliente YouTube Data API v3. API key only (sin OAuth) para acceso público.
 *
 * Quota diario: 10k unidades. Cost:
 *   - search.list = 100 unidades por llamada (cap 50 resultados).
 *   - videos.list = 1 unidad por llamada (cap 50 ids por llamada).
 *
 * Flujo: search → extrae videoIds → videos.list para enriquecer con stats.
 */

const YT_TIMEOUT_MS = 20_000;

type YTSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
  };
};
type YTVideoItem = {
  id?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    tags?: string[];
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
};

async function getJson<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), YT_TIMEOUT_MS);
  try {
    // Con reintentos ante 5xx/429 transitorios de la Data API. Ojo: el 403 de
    // cuota agotada NO se reintenta (no es transitorio dentro del día) y sigue
    // subiendo tal cual.
    const res = await fetchWithRetry(url, { signal: ctl.signal }, { label: "YouTube Data API" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`YouTube HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Obtiene la API key descifrada del LLMProvider YOUTUBE. */
export async function getYouTubeApiKey(userId: string): Promise<string | null> {
  const provider = await prisma.lLMProvider.findFirst({
    where: { userId, providerType: "YOUTUBE", isActive: true },
    select: { encryptedApiKey: true },
  });
  if (!provider) return null;
  try {
    return decrypt(provider.encryptedApiKey);
  } catch {
    return null;
  }
}

/** Valida la API key contra un search mínimo. */
export async function validateYouTubeApiKey(
  apiKey: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=id&maxResults=1&type=video&q=test&key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 403 || res.status === 400) {
      const body = await res.json().catch(() => ({}));
      const reason = body?.error?.errors?.[0]?.reason ?? `HTTP ${res.status}`;
      return { valid: false, error: `YouTube rechazó la key: ${reason}` };
    }
    if (!res.ok) return { valid: false, error: `HTTP ${res.status}` };
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Error de red.",
    };
  }
}

export type YTSearchOptions = {
  query: string;
  maxResults?: number; // 1-50
  order?: "relevance" | "date" | "rating" | "viewCount";
  publishedAfter?: Date;
};

/** Ejecuta search + videos y devuelve items enriquecidos con stats. */
export async function searchYouTubeVideos(
  apiKey: string,
  opts: YTSearchOptions,
): Promise<YTVideoItem[]> {
  const maxResults = Math.max(1, Math.min(50, opts.maxResults ?? 30));
  const qs = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: String(maxResults),
    q: opts.query,
    order: opts.order ?? "relevance",
    key: apiKey,
  });
  if (opts.publishedAfter) {
    qs.set("publishedAfter", opts.publishedAfter.toISOString());
  }
  const searchUrl = `https://www.googleapis.com/youtube/v3/search?${qs.toString()}`;
  const searchJson = await getJson<{ items?: YTSearchItem[] }>(searchUrl);
  const items = searchJson.items ?? [];
  const videoIds = items
    .map((it) => it.id?.videoId)
    .filter((v): v is string => typeof v === "string" && v.length > 0);
  if (videoIds.length === 0) return [];
  // Enriquecimiento con statistics.
  const vQs = new URLSearchParams({
    part: "snippet,statistics",
    id: videoIds.join(","),
    key: apiKey,
  });
  const videosUrl = `https://www.googleapis.com/youtube/v3/videos?${vQs.toString()}`;
  const videosJson = await getJson<{ items?: YTVideoItem[] }>(videosUrl);
  return videosJson.items ?? [];
}

export type YTNormalized = {
  title: string;
  url: string;
  snippet: string | null;
  summary: string | null;
  publishedAt: Date | null;
  author: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: null;
};

export function normalizeYouTubeVideo(v: YTVideoItem): YTNormalized | null {
  if (!v.id || !v.snippet?.title) return null;
  const desc = v.snippet.description ?? "";
  const pub = v.snippet.publishedAt ? new Date(v.snippet.publishedAt) : null;
  return {
    title: v.snippet.title.slice(0, 300),
    url: `https://www.youtube.com/watch?v=${v.id}`,
    snippet: desc.slice(0, 500) || null,
    summary: desc || null,
    publishedAt: pub && !isNaN(pub.getTime()) ? pub : null,
    author: v.snippet.channelTitle ?? null,
    reach: v.statistics?.viewCount ? Number(v.statistics.viewCount) : null,
    likes: v.statistics?.likeCount ? Number(v.statistics.likeCount) : null,
    comments: v.statistics?.commentCount
      ? Number(v.statistics.commentCount)
      : null,
    shares: null,
  };
}
