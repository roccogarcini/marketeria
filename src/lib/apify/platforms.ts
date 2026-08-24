/**
 * Mapeo por plataforma: item crudo de un Actor → forma canónica de Finding.
 *
 * Cada plataforma define:
 *   - el actorId por defecto (se puede sobrescribir por Source vía configJson.actorId)
 *   - el builder del `input` del Actor a partir de un `query` de usuario y unos
 *     filtros extra estructurados (fecha, idioma, sort, etc.) — los filtros
 *     conocidos por plataforma están descritos en `filters` para que la UI los
 *     pueda renderizar dinámicamente y la API los valide
 *   - el mapper de cada item del dataset al shape del Finding
 *
 * Shape final:
 *   { title, url, snippet, summary?, fullContent?, publishedAt?, author?,
 *     reach, likes, comments, shares }
 *
 * `fullContent` lleva el texto ÍNTEGRO de la pieza (caption/post/tweet/
 * descripción) tal como lo devuelve el actor, cap ~20k chars — es la materia
 * prima anti-invención de ideación/producción. Las métricas de engagement
 * (reach/likes/comments/shares) se mapean desde los campos reales de cada
 * actor, con fallbacks por nombre; si el actor no las devuelve quedan null
 * sin romper nada.
 */

export type Platform =
  | "INSTAGRAM"
  | "TIKTOK"
  | "YOUTUBE"
  | "FACEBOOK"
  | "LINKEDIN"
  | "X";

export type FilterValue = string | number | boolean | null;

/**
 * Descripción declarativa de un filtro extra por plataforma.
 * El `key` debe coincidir con el parámetro nativo del Actor de Apify.
 * Lo usa la UI para pintar inputs y el server para validar/mergear.
 */
export type FilterDef = {
  key: string;
  label: string;
  hint?: string;
} & (
  | { type: "string"; placeholder?: string; default?: string }
  | { type: "number"; min?: number; max?: number; default?: number; placeholder?: string }
  | { type: "date"; default?: string }
  | { type: "select"; options: { value: string; label: string }[]; default?: string }
  | { type: "boolean"; default?: boolean }
);

export type PlatformDef = {
  label: string;
  defaultActorId: string;
  /** Construye el input del Actor a partir de la query, el límite y los filtros extra. */
  buildInput: (
    query: string,
    maxItems: number,
    filters: Record<string, FilterValue>,
  ) => Record<string, unknown>;
  /** Normaliza un item del dataset al shape de Finding. null si no es utilizable. */
  mapItem: (raw: unknown) => NormalizedFinding | null;
  /** Pistas de UI para explicar qué poner en el query. */
  queryHint: string;
  /** Filtros extra que la UI puede ofrecer y la API acepta. */
  filters: FilterDef[];
  /**
   * Ranking local para plataformas cuyo actor no sabe ordenar por engagement
   * (p. ej. el hashtag scraper de Instagram devuelve recientes): se piden
   * `oversample`× más items al actor, se ordenan con `compare` y el consumidor
   * se queda solo con los `maxItems` mejores. Sin `rank`, comportamiento de
   * siempre (el orden del actor).
   */
  rank?: {
    oversample: number;
    compare: (a: NormalizedFinding, b: NormalizedFinding) => number;
  };
};

export type NormalizedFinding = {
  title: string;
  url: string | null;
  snippet: string | null;
  summary: string | null;
  /** Texto completo de la pieza original (cap 20k chars). */
  fullContent: string | null;
  publishedAt: Date | null;
  author: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
};

/** Cap del texto completo — mismo límite que documenta Finding.fullContent. */
export const FULL_CONTENT_MAX_CHARS = 20_000;

/** Texto completo normalizado: null si vacío, recortado al cap. */
export function capFullContent(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, FULL_CONTENT_MAX_CHARS);
}

type AnyObj = Record<string, unknown>;

function asObj(x: unknown): AnyObj | null {
  return x && typeof x === "object" && !Array.isArray(x)
    ? (x as AnyObj)
    : null;
}
function asNum(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return Math.round(x);
  if (typeof x === "string") {
    const n = Number(x);
    return Number.isFinite(n) ? Math.round(n) : null;
  }
  return null;
}
function asStr(x: unknown): string | null {
  if (typeof x === "string" && x.length > 0) return x;
  return null;
}
function asDate(x: unknown): Date | null {
  if (!x) return null;
  const d = new Date(x as string | number);
  return isNaN(d.getTime()) ? null : d;
}
/** Divide una query libre en tokens. Soporta coma, espacio, # y salto de línea. */
function splitTokens(query: string): string[] {
  return query
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^#/, ""));
}

/**
 * Aplica los filtros extra del usuario sobre un input base.
 * Sólo escribe claves cuyo valor sea utilizable (string no vacío,
 * número finito, boolean explícito). null/undefined/"" se ignoran
 * para no enviar parámetros vacíos al Actor.
 */
function mergeFilters(
  base: Record<string, unknown>,
  filters: Record<string, FilterValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (typeof v === "number" && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Países comunes para filtros de proxy/búsqueda.
 * (Lista corta + opción "(cualquiera)" implícita por dejarlo vacío.)
 */
const COUNTRY_OPTIONS = [
  { value: "US", label: "Estados Unidos" },
  { value: "ES", label: "España" },
  { value: "MX", label: "México" },
  { value: "AR", label: "Argentina" },
  { value: "CO", label: "Colombia" },
  { value: "CL", label: "Chile" },
  { value: "GB", label: "Reino Unido" },
  { value: "FR", label: "Francia" },
  { value: "DE", label: "Alemania" },
  { value: "BR", label: "Brasil" },
];

const LANGUAGE_OPTIONS = [
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
  { value: "pt", label: "Portugués" },
  { value: "fr", label: "Francés" },
  { value: "de", label: "Alemán" },
  { value: "it", label: "Italiano" },
];

/**
 * Comparador de virales: likes desc (ocultos/null al final), desempate por
 * comentarios y luego alcance. `likesCount: -1` = likes ocultos por el autor.
 */
function compareByLikes(a: NormalizedFinding, b: NormalizedFinding): number {
  const norm = (n: number | null) => (n !== null && n >= 0 ? n : -1);
  return (
    norm(b.likes) - norm(a.likes) ||
    norm(b.comments) - norm(a.comments) ||
    norm(b.reach) - norm(a.reach)
  );
}

/**
 * INSTAGRAM — apify/instagram-hashtag-scraper
 * Input típico: { hashtags: [...], resultsLimit, keywordSearch, resultsType }
 * El feed de HASHTAG del actor solo trae posts recientes (Instagram no expone
 * "destacados"): ordenar por likes ahí reordena posts de hace horas. Por eso
 * por defecto se usa keywordSearch (la búsqueda de Instagram, que favorece
 * contenido popular) + `rank`: sobremuestreo y orden por likes para quedarse
 * con lo más viral. El filtro permite volver al feed de recientes.
 */
const INSTAGRAM: PlatformDef = {
  label: "Instagram",
  defaultActorId: "apify~instagram-hashtag-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        hashtags: splitTokens(query),
        resultsLimit: max,
        keywordSearch: true,
      },
      filters,
    ),
  queryHint: "Temas o hashtags separados por coma (sin #): ej. ai, claudecode, devtools",
  rank: { oversample: 5, compare: compareByLikes },
  filters: [
    {
      key: "keywordSearch",
      label: "Búsqueda popular (por palabra clave)",
      type: "boolean",
      default: true,
      hint: "Activada: usa la búsqueda de Instagram, que favorece lo popular. Desactívala para el feed de posts recientes del hashtag.",
    },
    {
      key: "resultsType",
      label: "Tipo de contenido",
      type: "select",
      default: "posts",
      options: [
        { value: "posts", label: "Posts" },
        { value: "reels", label: "Reels" },
      ],
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.url) ?? asStr(o.inputUrl);
    const caption = asStr(o.caption);
    const title =
      caption ??
      asStr(o.title) ??
      (url ? `Post de ${asStr(o.ownerUsername) ?? "Instagram"}` : null);
    if (!title) return null;
    return {
      title: title.slice(0, 300),
      url,
      snippet: caption?.slice(0, 500) ?? null,
      summary: caption ?? null,
      fullContent: capFullContent(caption),
      publishedAt: asDate(o.timestamp),
      author: asStr(o.ownerUsername) ?? asStr(o.ownerFullName),
      // Vistas de vídeo (los posts de imagen no exponen alcance).
      reach:
        asNum(o.videoViewCount) ??
        asNum(o.videoPlayCount) ??
        asNum(o.igPlayCount) ??
        asNum(o.playCount) ??
        null,
      likes: asNum(o.likesCount) ?? asNum(o.likeCount),
      comments: asNum(o.commentsCount) ?? asNum(o.commentCount),
      // Reposts/reshares: solo lo devuelven versiones nuevas del actor.
      shares: asNum(o.reshareCount) ?? asNum(o.sharesCount),
    };
  },
};

/**
 * TIKTOK — clockworks/free-tiktok-scraper
 * Input típico: { hashtags: ["ai"], resultsPerPage: 30, ... }
 */
const TIKTOK: PlatformDef = {
  label: "TikTok",
  defaultActorId: "clockworks~free-tiktok-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        hashtags: splitTokens(query),
        resultsPerPage: max,
        shouldDownloadVideos: false,
      },
      filters,
    ),
  queryHint: "Hashtags separados por coma: ej. ai, sre, claudecode",
  filters: [
    {
      key: "searchSection",
      label: "Buscar en",
      type: "select",
      default: "video",
      options: [
        { value: "video", label: "Vídeos" },
        { value: "user", label: "Usuarios" },
      ],
    },
    {
      key: "oldestPostDateUnified",
      label: "Posts desde",
      type: "date",
      hint: "Fecha mínima de publicación.",
    },
    {
      key: "newestPostDate",
      label: "Posts hasta",
      type: "date",
      hint: "Fecha máxima de publicación.",
    },
    {
      key: "proxyCountryCode",
      label: "País del proxy",
      type: "select",
      options: [{ value: "", label: "(cualquiera)" }, ...COUNTRY_OPTIONS],
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.webVideoUrl) ?? asStr(o.shareUrl) ?? null;
    const text = asStr(o.text);
    const title = text ?? asStr(o.title) ?? (url ? `Vídeo TikTok` : null);
    if (!title) return null;
    const author = asObj(o.authorMeta);
    return {
      title: title.slice(0, 300),
      url,
      snippet: text?.slice(0, 500) ?? null,
      summary: text ?? null,
      fullContent: capFullContent(text),
      publishedAt: asDate(o.createTimeISO ?? o.createTime),
      author: author ? (asStr(author.name) ?? asStr(author.nickName)) : null,
      reach: asNum(o.playCount) ?? asNum(o.viewCount),
      likes: asNum(o.diggCount) ?? asNum(o.likesCount),
      comments: asNum(o.commentCount) ?? asNum(o.commentsCount),
      shares: asNum(o.shareCount) ?? asNum(o.sharesCount),
    };
  },
};

/**
 * YOUTUBE — streamers/youtube-scraper
 * Input típico: { searchQueries: ["claude code"], maxResults: 30, ... }
 */
const YOUTUBE: PlatformDef = {
  label: "YouTube",
  defaultActorId: "streamers~youtube-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        searchQueries: splitTokens(query),
        maxResults: max,
        maxResultsShorts: 0,
        maxResultStreams: 0,
      },
      filters,
    ),
  queryHint:
    "Queries de búsqueda separados por coma: ej. claude code tutorial, MCP servers demo",
  filters: [
    {
      key: "dateFilter",
      label: "Fecha de subida",
      type: "select",
      options: [
        { value: "", label: "(cualquiera)" },
        { value: "hour", label: "Última hora" },
        { value: "today", label: "Hoy" },
        { value: "week", label: "Esta semana" },
        { value: "month", label: "Este mes" },
        { value: "year", label: "Este año" },
      ],
    },
    {
      key: "videoLengthFilter",
      label: "Duración",
      type: "select",
      options: [
        { value: "", label: "(cualquiera)" },
        { value: "short", label: "Corta (<4 min)" },
        { value: "medium", label: "Media (4–20 min)" },
        { value: "long", label: "Larga (>20 min)" },
      ],
    },
    {
      key: "videoSortFilter",
      label: "Orden",
      type: "select",
      default: "relevance",
      options: [
        { value: "relevance", label: "Relevancia" },
        { value: "uploadDate", label: "Fecha de subida" },
        { value: "viewCount", label: "Vistas" },
        { value: "rating", label: "Valoración" },
      ],
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.url) ?? asStr(o.videoUrl);
    const title = asStr(o.title);
    if (!title) return null;
    const description = asStr(o.description) ?? asStr(o.text);
    return {
      title: title.slice(0, 300),
      url,
      snippet: description?.slice(0, 500) ?? null,
      summary: description ?? null,
      // Descripción íntegra del vídeo (+ subtítulos no: demasiado ruido).
      fullContent: capFullContent(description),
      publishedAt: asDate(o.date),
      author: asStr(o.channelName) ?? asStr(o.channelTitle),
      reach: asNum(o.viewCount) ?? asNum(o.views),
      likes: asNum(o.likes) ?? asNum(o.likeCount),
      comments: asNum(o.commentsCount) ?? asNum(o.comments) ?? asNum(o.numberOfComments),
      shares: null, // YouTube no expone compartidos por API/scraping
    };
  },
};

/**
 * FACEBOOK — apify/facebook-posts-scraper
 * Input típico: { startUrls: [{url:"..."}], resultsLimit, onlyPostsNewerThan? }
 */
const FACEBOOK: PlatformDef = {
  label: "Facebook",
  defaultActorId: "apify~facebook-posts-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        startUrls: splitTokens(query).map((u) => ({
          url: u.startsWith("http") ? u : `https://facebook.com/${u}`,
        })),
        resultsLimit: max,
      },
      filters,
    ),
  queryHint:
    "URLs de páginas o usernames separados por coma: ej. https://facebook.com/anthropic, openai",
  filters: [
    {
      key: "onlyPostsNewerThan",
      label: "Sólo posts más nuevos que",
      type: "string",
      placeholder: "ej. 2 weeks, 1 month, 2024-01-01",
      hint: "Acepta '2 weeks', '3 days' o fecha ISO. Vacío = sin filtro.",
    },
    {
      key: "language",
      label: "Idioma",
      type: "select",
      options: [{ value: "", label: "(cualquiera)" }, ...LANGUAGE_OPTIONS],
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.url) ?? asStr(o.postUrl) ?? asStr(o.facebookUrl);
    const text = asStr(o.text) ?? asStr(o.message);
    const title =
      asStr(o.title) ?? text?.slice(0, 140) ?? (url ? `Post de Facebook` : null);
    if (!title) return null;
    return {
      title: title.slice(0, 300),
      url,
      snippet: text?.slice(0, 500) ?? null,
      summary: text,
      fullContent: capFullContent(text),
      publishedAt: asDate(o.time ?? o.timestamp),
      author:
        asStr(o.user) ??
        asStr(o.pageName) ??
        (asObj(o.user)?.name as string | undefined) ??
        null,
      // Solo los posts de vídeo exponen vistas.
      reach: asNum(o.viewsCount) ?? asNum(o.playCount),
      likes:
        asNum(o.likesCount) ??
        asNum((asObj(o.reactions) as AnyObj | null)?.totalCount) ??
        asNum(o.reactionsCount) ??
        asNum(o.likes),
      comments: asNum(o.commentsCount) ?? asNum(o.comments),
      shares: asNum(o.sharesCount) ?? asNum(o.shares),
    };
  },
};

/**
 * LINKEDIN — apify/linkedin-posts-search-scraper
 * Input típico: { keywords: [...], resultsLimit, datePosted?, sortBy? }
 */
const LINKEDIN: PlatformDef = {
  label: "LinkedIn",
  defaultActorId: "apify~linkedin-posts-search-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        keywords: splitTokens(query),
        resultsLimit: max,
      },
      filters,
    ),
  queryHint: "Keywords/temas separados por coma: ej. AI agents, prompt engineering",
  filters: [
    {
      key: "datePosted",
      label: "Publicado en",
      type: "select",
      options: [
        { value: "", label: "(cualquier fecha)" },
        { value: "past-24h", label: "Últimas 24h" },
        { value: "past-week", label: "Última semana" },
        { value: "past-month", label: "Último mes" },
      ],
    },
    {
      key: "sortBy",
      label: "Orden",
      type: "select",
      default: "relevance",
      options: [
        { value: "relevance", label: "Relevancia" },
        { value: "date_posted", label: "Más recientes" },
      ],
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.url) ?? asStr(o.postUrl);
    const text = asStr(o.text) ?? asStr(o.content);
    const title =
      asStr(o.title) ?? text?.slice(0, 140) ?? (url ? `Post LinkedIn` : null);
    if (!title) return null;
    // Algunas versiones del actor anidan las métricas en `stats`.
    const stats = asObj(o.stats);
    return {
      title: title.slice(0, 300),
      url,
      snippet: text?.slice(0, 500) ?? null,
      summary: text,
      fullContent: capFullContent(text),
      publishedAt: asDate(o.postedAt ?? o.timestamp),
      author: asStr(o.authorName) ?? asStr(o.author) ?? null,
      reach: asNum(o.numImpressions) ?? asNum(o.numViews) ?? asNum(stats?.views),
      likes:
        asNum(o.numLikes) ??
        asNum(o.likesCount) ??
        asNum(stats?.totalReactionCount) ??
        asNum(stats?.like),
      comments:
        asNum(o.numComments) ?? asNum(o.commentsCount) ?? asNum(stats?.comments),
      shares: asNum(o.numShares) ?? asNum(o.sharesCount) ?? asNum(stats?.shares),
    };
  },
};

/**
 * X (Twitter) — apidojo/tweet-scraper
 * Input típico: { searchTerms: [...], maxTweets, sort?, tweetLanguage?, start?, end? }
 */
const X_PLATFORM: PlatformDef = {
  label: "X (Twitter)",
  defaultActorId: "apidojo~tweet-scraper",
  buildInput: (query, max, filters) =>
    mergeFilters(
      {
        searchTerms: splitTokens(query),
        maxTweets: max,
      },
      filters,
    ),
  queryHint: "Términos de búsqueda separados por coma: ej. claude code, MCP",
  filters: [
    {
      key: "sort",
      label: "Ordenar por",
      type: "select",
      default: "Latest",
      options: [
        { value: "Latest", label: "Más recientes" },
        { value: "Top", label: "Más populares" },
      ],
    },
    {
      key: "tweetLanguage",
      label: "Idioma del tweet",
      type: "select",
      options: [{ value: "", label: "(cualquiera)" }, ...LANGUAGE_OPTIONS],
    },
    {
      key: "start",
      label: "Desde",
      type: "date",
      hint: "Tweets publicados desde esta fecha (incluida).",
    },
    {
      key: "end",
      label: "Hasta",
      type: "date",
      hint: "Tweets publicados hasta esta fecha (incluida).",
    },
  ],
  mapItem: (raw) => {
    const o = asObj(raw);
    if (!o) return null;
    const url = asStr(o.url) ?? asStr(o.twitterUrl);
    // fullText primero: en tweets largos `text` viene truncado.
    const text = asStr(o.fullText) ?? asStr(o.text);
    const title =
      asStr(o.title) ?? text?.slice(0, 140) ?? (url ? `Tweet` : null);
    if (!title) return null;
    const author = asObj(o.author) ?? asObj(o.user);
    return {
      title: title.slice(0, 300),
      url,
      snippet: text?.slice(0, 500) ?? null,
      summary: text,
      fullContent: capFullContent(text),
      publishedAt: asDate(o.createdAt ?? o.timestamp),
      author: author
        ? (asStr(author.userName) ?? asStr(author.name) ?? null)
        : null,
      reach: asNum(o.viewCount) ?? asNum(o.views),
      likes: asNum(o.likeCount) ?? asNum(o.favouritesCount),
      comments: asNum(o.replyCount),
      shares: asNum(o.retweetCount) ?? asNum(o.retweets),
    };
  },
};

export const PLATFORMS: Record<Platform, PlatformDef> = {
  INSTAGRAM,
  TIKTOK,
  YOUTUBE,
  FACEBOOK,
  LINKEDIN,
  X: X_PLATFORM,
};

// YouTube se busca por la API oficial (directa, gratis) desde "Buscar en
// YouTube", no por Apify. Por eso no aparece en el picker de Apify.
export const PLATFORM_LIST: Platform[] = [
  "INSTAGRAM",
  "TIKTOK",
  "FACEBOOK",
  "LINKEDIN",
  "X",
];

/**
 * Límite a pedir al Actor: con `rank`, sobremuestrea (cap 100 — mismo tope que
 * la API) para tener de dónde elegir los mejores; sin `rank`, el límite pedido.
 */
export function fetchLimitFor(def: PlatformDef, maxItems: number): number {
  return def.rank ? Math.min(100, maxItems * def.rank.oversample) : maxItems;
}

/**
 * Ordena los findings mapeados según el `rank` de la plataforma (los mejores
 * primero). Sin `rank`, devuelve la lista tal cual (orden del actor).
 */
export function rankFindings(
  def: PlatformDef,
  findings: NormalizedFinding[],
): NormalizedFinding[] {
  if (!def.rank) return findings;
  return [...findings].sort(def.rank.compare);
}

/**
 * Sanitiza filtros recibidos de cliente/configJson contra la def de la plataforma:
 * descarta claves no declaradas, fuerza tipos según la `FilterDef`, ignora vacíos.
 * Devuelve un objeto seguro para mergear en `buildInput`.
 */
export function sanitizeFilters(
  platform: Platform,
  raw: unknown,
): Record<string, FilterValue> {
  const def = PLATFORMS[platform];
  if (!def || !raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const input = raw as Record<string, unknown>;
  const out: Record<string, FilterValue> = {};
  for (const f of def.filters) {
    const v = input[f.key];
    if (v === undefined || v === null) continue;
    switch (f.type) {
      case "string": {
        if (typeof v !== "string") break;
        const s = v.trim();
        if (s) out[f.key] = s;
        break;
      }
      case "number": {
        const n = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(n)) break;
        let final = n;
        if (typeof f.min === "number") final = Math.max(f.min, final);
        if (typeof f.max === "number") final = Math.min(f.max, final);
        out[f.key] = final;
        break;
      }
      case "date": {
        if (typeof v !== "string") break;
        const s = v.trim();
        if (!s) break;
        // YYYY-MM-DD del <input type=date> → ISO. Si ya es ISO se acepta tal cual.
        const d = new Date(s);
        if (!isNaN(d.getTime())) out[f.key] = d.toISOString();
        break;
      }
      case "select": {
        if (typeof v !== "string") break;
        const s = v.trim();
        if (!s) break;
        if (f.options.some((o) => o.value === s)) out[f.key] = s;
        break;
      }
      case "boolean": {
        if (typeof v === "boolean") out[f.key] = v;
        break;
      }
    }
  }
  return out;
}
