import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchWithRetry } from "@/lib/net/retry";

/**
 * Cliente de Tavily Search — API de búsqueda web diseñada para LLMs.
 * Devuelve resultados limpios (título, url, contenido) listos para que un
 * LLM los estructure en hallazgos. Se usa como motor de búsqueda en la
 * "Investigación IA" cuando el proveedor LLM no tiene búsqueda web nativa
 * (deepseek, z.ai/GLM, custom…).
 *
 * Docs: https://docs.tavily.com/
 */

const TAVILY_BASE = "https://api.tavily.com";
const TAVILY_TIMEOUT_MS = 30_000;

export type TavilyResult = {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string | null;
};

/** Obtiene la API key de Tavily descifrada del usuario. null si no hay. */
export async function getTavilyKey(userId: string): Promise<string | null> {
  const provider = await prisma.lLMProvider.findFirst({
    where: { userId, providerType: "TAVILY", isActive: true },
    select: { encryptedApiKey: true },
  });
  if (!provider) return null;
  try {
    return decrypt(provider.encryptedApiKey);
  } catch {
    return null;
  }
}

/** Valida una API key de Tavily con una búsqueda mínima. */
export async function validateTavilyKey(
  key: string,
): Promise<{ valid: true } | { valid: false; error: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch(`${TAVILY_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query: "test", max_results: 1 }),
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (res.status === 401) return { valid: false, error: "API key inválida." };
    if (!res.ok) {
      return { valid: false, error: `Tavily respondió ${res.status}.` };
    }
    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Error de red.",
    };
  }
}

/**
 * Ejecuta una búsqueda web vía Tavily. Devuelve resultados normalizados.
 * `daysBack` filtra por recencia (Tavily `days`); `maxResults` limita.
 */
export async function tavilySearch(
  key: string,
  query: string,
  opts: { maxResults?: number; daysBack?: number; searchDepth?: "basic" | "advanced" } = {},
): Promise<TavilyResult[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TAVILY_TIMEOUT_MS);
  try {
    // Con reintentos: el 429 de Tavily (plan gratuito, ráfagas del cron) es
    // frecuente y transitorio; sin reintento tumbaba la investigación entera.
    const res = await fetchWithRetry(
      `${TAVILY_BASE}/search`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          query,
          max_results: Math.max(1, Math.min(20, opts.maxResults ?? 10)),
          search_depth: opts.searchDepth ?? "advanced",
          topic: "general",
          ...(opts.daysBack ? { days: opts.daysBack } : {}),
        }),
        signal: ctl.signal,
      },
      { label: "Tavily /search" },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Tavily ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };
    return (data.results ?? [])
      .filter((r) => r.url && r.title)
      .map((r) => ({
        title: (r.title ?? "").slice(0, 300),
        url: r.url as string,
        content: (r.content ?? "").slice(0, 2000),
        score: r.score,
        publishedDate: r.published_date ?? null,
      }));
  } finally {
    clearTimeout(t);
  }
}
