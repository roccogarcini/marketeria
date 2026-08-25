import Parser from "rss-parser";
import { prisma } from "@/lib/prisma";
import {
  getApifyToken,
  runApifyActor,
  mapGenericApifyItem,
} from "@/lib/apify/client";
import {
  PLATFORMS,
  fetchLimitFor,
  rankFindings,
  sanitizeFilters,
  type Platform,
  type FilterValue,
} from "@/lib/apify/platforms";
import {
  getYouTubeApiKey,
  searchYouTubeVideos,
  normalizeYouTubeVideo,
} from "@/lib/youtube/client";
import { runAIResearch } from "./ai-research";
import { buildPostsUrl, parsePostsResponse, type WordPressConfig } from "./wordpress";
import { createFindingIfNew } from "./findings";
import { assertPublicUrl } from "@/lib/net/ssrf-guard";
import { fetchWithRetry } from "@/lib/net/retry";

/**
 * Ejecuta el fetch de una Source:
 *  - MANUAL       → no-op (la captura se hace desde UI).
 *  - URL          → descarga HTML y crea un Finding con título+snippet.
 *  - RSS          → parsea el feed y crea Findings (dedupe por url).
 *  - WORDPRESS    → lee /wp-json/wp/v2/posts del sitio y crea un Finding por
 *                   entrada, con el cuerpo completo ya incluido.
 *  - APIFY        → llama al actor configurado y mapea cada item a Finding.
 *  - YOUTUBE      → busca vía Data API y mapea cada vídeo a Finding.
 *  - AI_RESEARCH  → investigación IA: brief → búsqueda web (nativa o Tavily)
 *                   → hallazgos estructurados por el LLM.
 *
 * Robustez: timeout 15s para fetchers HTTP, fallo silencioso que actualiza
 * `lastFetchedAt` y devuelve metadatos.
 */

const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = "MarketeriaBot/1.0";
const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000; // 5 MB

/**
 * Tope de bytes que aceptamos descargar de una fuente externa
 * (`RESEARCH_MAX_RESPONSE_BYTES`). Se lee en cada llamada: es una lectura de
 * env, no cuesta nada, y permite ajustarlo sin tocar el módulo.
 */
function maxResponseBytes(): number {
  const raw = Number(process.env.RESEARCH_MAX_RESPONSE_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_RESPONSE_BYTES;
}

/**
 * Lee el cuerpo como texto CORTANDO el stream al llegar al tope. `res.text()`
 * acumula en memoria todo lo que mande el servidor: una fuente que responda
 * cientos de MB (o un stream que no termine) tumbaba el proceso por OOM antes
 * de que el timeout llegara a saltar.
 *
 * Preferimos fallar a devolver texto truncado: un HTML/RSS a medias parsea mal
 * y produciría hallazgos corruptos en silencio.
 */
async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new Error(
      `Respuesta demasiado grande: ${declared} bytes declarados (tope ${maxBytes}).`,
    );
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let out = "";
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error(
          `Respuesta demasiado grande: se superaron los ${maxBytes} bytes (tope).`,
        );
      }
      out += decoder.decode(value, { stream: true });
    }
    return out + decoder.decode();
  } finally {
    // Corta la descarga: sin esto el servidor seguiría enviando datos.
    await reader.cancel().catch(() => {});
  }
}

// Redirects manuales: cada salto (incluida la URL inicial) pasa por el guard
// anti-SSRF. El AbortController único acota el tiempo total, saltos incluidos.
// Exportado: el enriquecimiento de hallazgos (enrich.ts) lo reutiliza.
export async function fetchWithTimeout(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      await assertPublicUrl(current);
      // Con reintento ante 429/5xx: un pico puntual de la fuente no debe
      // tumbar la ejecución entera del cron.
      const res = await fetchWithRetry(current, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`HTTP ${res.status} sin Location`);
        await res.body?.cancel();
        current = new URL(location, current).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await readTextCapped(res, maxResponseBytes());
    }
    throw new Error(`Demasiados redirects (>${MAX_REDIRECTS})`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Parsea el `configJson` de una fuente. Si el JSON está roto lanza un error
 * que lo dice: tragarse el fallo y seguir con los valores por defecto deja al
 * operador viendo "0 hallazgos" o un mensaje falso ("sin 'query' en
 * configJson") cuando la query SÍ está escrita y lo roto es el JSON.
 *
 * Devuelve `null` si no hay configuración (caso legítimo: la fuente usa los
 * defaults).
 */
function parseSourceConfig<T extends Record<string, unknown>>(source: {
  name: string;
  type: string;
  configJson: string | null;
}): T | null {
  if (!source.configJson) return null;
  try {
    const parsed = JSON.parse(source.configJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("no es un objeto JSON");
    }
    return parsed as T;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[fetcher] Source "${source.name}" (${source.type}): configJson inválido → ${detail}`,
    );
    throw new Error(
      `El configJson de la fuente "${source.name}" no es JSON válido (${detail}). ` +
        `Corrígelo en Investigación → Fuentes.`,
    );
  }
}

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].trim().slice(0, 300) : null;
}

function extractDescription(html: string): string | null {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
  return m ? m[1].trim().slice(0, 800) : null;
}

export type FetchOutcome = {
  sourceId: string;
  type: string;
  created: number;
  skipped: number;
  error: string | null;
  // Solo para AI_RESEARCH: qué proveedor LLM y qué motor (nativo/Tavily) se usó,
  // qué proveedor se pidió (para avisar de fallback) y los intentos fallidos.
  researchProvider?: string | null;
  researchVia?: string | null;
  researchRequested?: string | null;
  researchAttempts?: string[];
};

export async function runSourceFetch(
  sourceId: string,
  opts: { userId?: string } = {},
): Promise<FetchOutcome> {
  const source = await prisma.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error("Source not found");

  const outcome: FetchOutcome = {
    sourceId: source.id,
    type: source.type,
    created: 0,
    skipped: 0,
    error: null,
  };

  try {
    if (source.type === "MANUAL") {
      // no-op
    } else if (source.type === "WHATSAPP") {
      // Fuente de ENTRADA: los mensajes llegan por webhook, no se van a
      // buscar. "Refrescar" no tiene nada que hacer aquí, y decirlo es mejor
      // que un 0 hallazgos que parece un fallo.
      throw new Error(
        "WhatsApp es una fuente de entrada: los mensajes llegan solos por el " +
          "webhook. No hay nada que refrescar a mano.",
      );
    } else if (source.type === "URL") {
      if (!source.url) throw new Error("URL sin url configurada");
      const html = await fetchWithTimeout(source.url);
      const title = extractTitle(html) ?? source.url;
      const snippet = extractDescription(html);
      const created = await createFindingIfNew({
        sourceId: source.id,
        title,
        url: source.url,
        snippet,
        status: "NEW",
      });
      if (created) outcome.created++;
      else outcome.skipped++;
    } else if (source.type === "APIFY") {
      if (!opts.userId) throw new Error("APIFY requiere userId para leer el token.");
      const token = await getApifyToken(opts.userId);
      if (!token) throw new Error("Token Apify no configurado en /admin/proveedores.");

      // El configJson se parsea UNA vez para las dos ramas (dinámica y por
      // plataforma); si está roto, el error explica qué pasa en vez de caer a
      // los defaults y morir después con un "sin 'query'" engañoso.
      const apifyCfg = parseSourceConfig<{
        dynamic?: boolean;
        actorId?: string;
        input?: Record<string, unknown>;
        maxItems?: number;
        query?: string;
        filters?: unknown;
      }>(source);

      // ── Modo DINÁMICO: actor arbitrario elegido por el usuario, con su
      // input tal cual y mapeo genérico de resultados a hallazgos. ──────────
      const dyn =
        apifyCfg?.dynamic && apifyCfg.actorId
          ? (apifyCfg as { actorId: string; input?: Record<string, unknown>; maxItems?: number })
          : null;
      if (dyn?.actorId) {
        const items = await runApifyActor(token, dyn.actorId, dyn.input ?? {}, {
          maxItems: dyn.maxItems ?? 30,
        });
        for (const raw of items) {
          const mapped = mapGenericApifyItem(raw);
          if (!mapped) continue;
          const created = await createFindingIfNew({
            sourceId: source.id,
            title: mapped.title,
            url: mapped.url,
            snippet: mapped.snippet,
            summary: mapped.summary,
            fullContent: mapped.fullContent,
            reach: mapped.reach,
            likes: mapped.likes,
            comments: mapped.comments,
            shares: mapped.shares,
            status: "NEW",
          });
          if (created) outcome.created++;
          else outcome.skipped++;
        }
        await prisma.source.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date() },
        });
        return outcome;
      }

      const platform = (source.platform ?? "").toUpperCase() as Platform;
      const def = PLATFORMS[platform];
      if (!def) throw new Error(`Plataforma APIFY desconocida: ${source.platform}`);

      // Params guardados en configJson: { actorId?, query, maxItems?, filters? }
      let query = "";
      let actorId = def.defaultActorId;
      let maxItems = 30;
      let filters: Record<string, FilterValue> = {};
      if (apifyCfg) {
        const cfg = apifyCfg;
        if (typeof cfg.query === "string") query = cfg.query;
        if (typeof cfg.actorId === "string" && cfg.actorId) actorId = cfg.actorId;
        if (typeof cfg.maxItems === "number") maxItems = Math.max(1, Math.min(100, cfg.maxItems));
        filters = sanitizeFilters(platform, cfg.filters);
      }
      if (!query) throw new Error("Source APIFY sin 'query' en configJson.");

      // Con rank (Instagram): sobremuestreo + orden por likes, y nos quedamos
      // con los `maxItems` más virales; sin rank, comportamiento de siempre.
      const fetchLimit = fetchLimitFor(def, maxItems);
      const items = await runApifyActor(
        token,
        actorId,
        def.buildInput(query, fetchLimit, filters),
        { maxItems: fetchLimit },
      );

      const mappedItems = [];
      for (const raw of items) {
        const mapped = def.mapItem(raw);
        if (mapped) mappedItems.push(mapped);
      }
      for (const mapped of rankFindings(def, mappedItems)) {
        if (outcome.created >= maxItems) break;
        const created = await createFindingIfNew({
          sourceId: source.id,
          title: mapped.title,
          url: mapped.url,
          snippet: mapped.snippet,
          summary: mapped.summary,
          fullContent: mapped.fullContent,
          author: mapped.author,
          publishedAt: mapped.publishedAt,
          reach: mapped.reach,
          likes: mapped.likes,
          comments: mapped.comments,
          shares: mapped.shares,
          status: "NEW",
        });
        if (created) outcome.created++;
        else outcome.skipped++;
      }
    } else if (source.type === "YOUTUBE") {
      if (!opts.userId) throw new Error("YOUTUBE requiere userId para leer la API key.");
      const apiKey = await getYouTubeApiKey(opts.userId);
      if (!apiKey) throw new Error("API key YouTube no configurada en /admin/proveedores.");

      let query = "";
      let maxItems = 30;
      let order: "relevance" | "date" | "rating" | "viewCount" = "relevance";
      let daysBack: number | null = null;
      const ytCfg = parseSourceConfig<{
        query?: string;
        maxItems?: number;
        order?: string;
        daysBack?: number;
      }>(source);
      if (ytCfg) {
        if (typeof ytCfg.query === "string") query = ytCfg.query;
        if (typeof ytCfg.maxItems === "number") maxItems = Math.max(1, Math.min(50, ytCfg.maxItems));
        if (
          ytCfg.order === "relevance" ||
          ytCfg.order === "date" ||
          ytCfg.order === "rating" ||
          ytCfg.order === "viewCount"
        ) order = ytCfg.order;
        if (typeof ytCfg.daysBack === "number") daysBack = ytCfg.daysBack;
      }
      if (!query) throw new Error("Source YOUTUBE sin 'query' en configJson.");

      const videos = await searchYouTubeVideos(apiKey, {
        query,
        maxResults: maxItems,
        order,
        publishedAfter: daysBack
          ? new Date(Date.now() - daysBack * 24 * 3600 * 1000)
          : undefined,
      });

      for (const v of videos) {
        const mapped = normalizeYouTubeVideo(v);
        if (!mapped) continue;
        const created = await createFindingIfNew({
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
        if (created) outcome.created++;
        else outcome.skipped++;
      }
    } else if (source.type === "RSS") {
      if (!source.url) throw new Error("RSS sin url");
      // Descarga propia (pasa por el guard anti-SSRF) en vez del cliente
      // HTTP interno de rss-parser, que sigue redirects sin validar.
      const parser = new Parser();
      const xml = await fetchWithTimeout(source.url);
      const feed = await parser.parseString(xml);
      for (const item of feed.items ?? []) {
        const url = item.link ?? null;
        const title = (item.title ?? "(sin título)").slice(0, 300);
        const snippet = (item.contentSnippet ?? item.content ?? null)?.slice(0, 800) ?? null;
        const created = await createFindingIfNew({
          sourceId: source.id,
          title,
          url,
          snippet,
          status: "NEW",
        });
        if (created) outcome.created++;
        else outcome.skipped++;
      }
    } else if (source.type === "WORDPRESS") {
      if (!source.url) throw new Error("WORDPRESS sin url del sitio");
      const wpCfg = parseSourceConfig<WordPressConfig>(source);
      // Misma descarga que RSS/URL: guard anti-SSRF, timeout, tope de bytes y
      // reintento ante 429/5xx. La API de WordPress es pública y sin clave.
      const body = await fetchWithTimeout(buildPostsUrl(source.url, wpCfg));
      for (const post of parsePostsResponse(body)) {
        const created = await createFindingIfNew({
          sourceId: source.id,
          title: post.title,
          url: post.url,
          snippet: post.snippet,
          // WordPress ya da el cuerpo entero: no hace falta enriquecer después
          // descargando la página, que es lo que toca con RSS.
          fullContent: post.fullContent,
          author: post.author,
          publishedAt: post.publishedAt,
          status: "NEW",
        });
        if (created) outcome.created++;
        else outcome.skipped++;
      }
    } else if (source.type === "AI_RESEARCH") {
      if (!opts.userId)
        throw new Error("AI_RESEARCH requiere userId para leer el proveedor.");
      let brief = "";
      let preferredProvider: string | null = null;
      let maxItems: number | undefined;
      let maxAgeMonths: number | undefined;
      const aiCfg = parseSourceConfig<{
        brief?: string;
        provider?: string;
        maxItems?: number;
        maxAgeMonths?: number;
      }>(source);
      if (aiCfg) {
        if (typeof aiCfg.brief === "string") brief = aiCfg.brief;
        if (typeof aiCfg.provider === "string") preferredProvider = aiCfg.provider;
        if (typeof aiCfg.maxItems === "number") maxItems = aiCfg.maxItems;
        if (typeof aiCfg.maxAgeMonths === "number") maxAgeMonths = aiCfg.maxAgeMonths;
      }
      if (!brief) throw new Error("Source AI_RESEARCH sin 'brief' en configJson.");

      const research = await runAIResearch({
        userId: opts.userId,
        brief,
        preferredProvider,
        maxItems,
        maxAgeMonths,
        // Traza cada llamada al LLM de la investigación con su fuente en
        // AIExecution (así el consumo es atribuible desde /admin/consumo).
        sourceId: source.id,
      });
      const findings = research.findings;
      outcome.researchProvider = research.provider;
      outcome.researchVia = research.via;
      outcome.researchRequested = research.requestedProvider;
      outcome.researchAttempts = research.attempts;
      for (const f of findings) {
        const created = await createFindingIfNew({
          sourceId: source.id,
          title: f.title,
          url: f.url,
          snippet: f.snippet,
          summary: f.summary,
          author: f.author,
          publishedAt: f.publishedAt,
          status: "NEW",
        });
        if (created) outcome.created++;
        else outcome.skipped++;
      }
    }
  } catch (err) {
    outcome.error = err instanceof Error ? err.message : "Error desconocido";
  }

  await prisma.source.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date() },
  });

  return outcome;
}
