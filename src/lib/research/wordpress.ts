import { extractMainText } from "./enrich";

/**
 * WordPress como fuente de investigación.
 *
 * Cualquier WordPress con la REST API abierta (lo normal desde la 4.7) sirve
 * un JSON en `/wp-json/wp/v2/posts` sin credenciales. Es el camino corto: en
 * vez de scrapear el HTML del sitio, pedimos las entradas ya estructuradas,
 * con su cuerpo completo y su fecha real de publicación.
 *
 * Esto NO habla con la base de datos ni descarga nada: construye la URL y mapea
 * la respuesta. La descarga la hace `fetchWithTimeout` del fetcher, que es
 * quien tiene el guard anti-SSRF, el tope de tamaño y los reintentos.
 */

const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 100;
const MAX_SNIPPET = 800;

export type WordPressConfig = {
  /** Cuántas entradas pedir (1-100). Por defecto 10. */
  perPage?: number;
  /** Filtro por texto: se lo pasamos al buscador de WordPress. */
  search?: string;
  /** IDs de categoría separados por coma, tal como los espera la API. */
  categories?: string;
};

export type WordPressFinding = {
  title: string;
  url: string | null;
  snippet: string | null;
  fullContent: string | null;
  author: string | null;
  publishedAt: Date | null;
};

/** Normaliza el `configJson` de la fuente, ignorando lo que venga mal puesto. */
export function normalizeConfig(raw: WordPressConfig | null): Required<
  Pick<WordPressConfig, "perPage">
> &
  Pick<WordPressConfig, "search" | "categories"> {
  const perPage =
    typeof raw?.perPage === "number" && Number.isFinite(raw.perPage)
      ? Math.max(1, Math.min(MAX_PER_PAGE, Math.trunc(raw.perPage)))
      : DEFAULT_PER_PAGE;
  const search = typeof raw?.search === "string" && raw.search.trim() ? raw.search.trim() : undefined;
  const categories =
    typeof raw?.categories === "string" && raw.categories.trim()
      ? raw.categories.trim()
      : undefined;
  return { perPage, search, categories };
}

/**
 * URL del endpoint de entradas.
 *
 * `_fields` recorta la respuesta a lo que usamos (una entrada de WordPress
 * completa trae decenas de campos que no miramos). Ojo: para que `_embed`
 * rellene el autor, `_links` TIENE que estar en `_fields` — sin él WordPress
 * devuelve `_embedded` vacío y no hay forma de saber por qué.
 */
export function buildPostsUrl(baseUrl: string, cfg: WordPressConfig | null): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("La fuente WORDPRESS no tiene URL del sitio.");
  const { perPage, search, categories } = normalizeConfig(cfg);

  const url = new URL(`${base}/wp-json/wp/v2/posts`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.set("orderby", "date");
  url.searchParams.set("order", "desc");
  url.searchParams.set("_fields", "id,link,title,excerpt,content,date_gmt,_links");
  url.searchParams.set("_embed", "author");
  if (search) url.searchParams.set("search", search);
  if (categories) url.searchParams.set("categories", categories);
  return url.toString();
}

type RenderedFieldRaw = { rendered?: unknown } | null | undefined;

function rendered(field: RenderedFieldRaw): string | null {
  if (!field || typeof field !== "object") return null;
  const value = (field as { rendered?: unknown }).rendered;
  return typeof value === "string" && value.trim() ? value : null;
}

/** Fecha en UTC. WordPress da `date_gmt` SIN zona; sin la Z se lee como local. */
function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const iso = /(Z|[+-]\d{2}:?\d{2})$/.test(value) ? value : `${value}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function embeddedAuthor(post: Record<string, unknown>): string | null {
  const embedded = post._embedded;
  if (!embedded || typeof embedded !== "object") return null;
  const authors = (embedded as { author?: unknown }).author;
  if (!Array.isArray(authors) || authors.length === 0) return null;
  const name = (authors[0] as { name?: unknown })?.name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/**
 * Una entrada de WordPress → un hallazgo. Devuelve null si no hay ni título ni
 * enlace: sin eso el hallazgo no le sirve a nadie en la bandeja.
 *
 * Los campos vienen como HTML (`rendered`), incluidas las entidades del
 * título (&amp;, &#8217;…), así que todos pasan por el mismo aplanado que usa
 * el enriquecimiento.
 */
export function mapWordPressPost(raw: unknown): WordPressFinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const post = raw as Record<string, unknown>;

  const title = extractMainText(rendered(post.title as RenderedFieldRaw) ?? "").slice(0, 300);
  const url = typeof post.link === "string" && post.link.trim() ? post.link.trim() : null;
  if (!title && !url) return null;

  const excerpt = extractMainText(rendered(post.excerpt as RenderedFieldRaw) ?? "");
  const content = extractMainText(rendered(post.content as RenderedFieldRaw) ?? "");

  return {
    title: title || url!,
    url,
    // Si no hay extracto (pasa cuando el tema lo desactiva), se corta el cuerpo.
    snippet: (excerpt || content).slice(0, MAX_SNIPPET) || null,
    fullContent: content || null,
    author: embeddedAuthor(post),
    publishedAt: parseDate(post.date_gmt),
  };
}

/**
 * Respuesta cruda del endpoint → hallazgos.
 *
 * Un WordPress con la REST API cerrada (o detrás de un plugin de seguridad)
 * contesta HTML o un objeto de error, no un array. Ese caso se dice con
 * claridad: sin esto el operador ve "0 hallazgos" y no sabe si es que no hay
 * entradas o que el sitio no expone la API.
 */
export function parsePostsResponse(body: string): WordPressFinding[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      "El sitio no ha devuelto JSON en /wp-json/wp/v2/posts. " +
        "Comprueba que es un WordPress y que su REST API está abierta.",
    );
  }
  if (!Array.isArray(data)) {
    const code = (data as { code?: unknown })?.code;
    const message = (data as { message?: unknown })?.message;
    if (typeof message === "string") {
      throw new Error(`WordPress ha respondido con un error: ${message}${code ? ` (${code})` : ""}`);
    }
    throw new Error("La REST API de WordPress no ha devuelto una lista de entradas.");
  }
  const out: WordPressFinding[] = [];
  for (const item of data) {
    const mapped = mapWordPressPost(item);
    if (mapped) out.push(mapped);
  }
  return out;
}
