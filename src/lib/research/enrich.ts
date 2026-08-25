import { prisma } from "@/lib/prisma";
import { fetchWithTimeout } from "./fetcher";

/**
 * Enriquecimiento de hallazgos: descarga la URL original y guarda el texto
 * principal en `Finding.fullContent`, para que ideación y producción trabajen
 * con la pieza real en vez de rellenar a partir del titular.
 *
 * - La descarga reutiliza el fetch del fetcher (guard anti-SSRF + timeout).
 * - La extracción es "readability ligera": preferimos <article>/<main>,
 *   quitamos script/style/nav/etc. y aplanamos el HTML a texto.
 * - Best-effort: los fallos (paywall, JS-only, 403…) no rompen el flujo que
 *   lo dispara; el hallazgo simplemente se queda con el material que tenía.
 */

const MAX_CONTENT_CHARS = 20_000;
// Si lo extraído es más corto que esto, probablemente es un shell de cookies
// o un "enable javascript" — no lo guardamos como contenido completo.
const MIN_USEFUL_CHARS = 400;

/**
 * Etiquetas que van DENTRO de una frase. Se borran sin dejar hueco: sustituir
 * `<strong>` por un espacio partía las palabras y dejaba "negritas ." con el
 * punto suelto.
 */
const INLINE_TAGS =
  "a|abbr|b|big|cite|code|del|em|font|i|ins|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|tt|u|var";

/**
 * Entidades con nombre más allá de las cinco de siempre. WordPress las usa a
 * manta en castellano (&aacute;, &ntilde;, &laquo;…): sin traducirlas, el
 * texto que llega al LLM va lleno de "p&aacute;rrafo".
 */
const NAMED_ENTITIES: Record<string, string> = {
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  acirc: "â", ecirc: "ê", icirc: "î", ocirc: "ô", ucirc: "û",
  auml: "ä", euml: "ë", iuml: "ï", ouml: "ö", uuml: "ü", Uuml: "Ü",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç",
  atilde: "ã", otilde: "õ", aring: "å", oslash: "ø", szlig: "ß",
  iexcl: "¡", iquest: "¿", ordf: "ª", ordm: "º", deg: "°",
  laquo: "«", raquo: "»", ldquo: "\u201C", rdquo: "\u201D",
  lsquo: "\u2018", rsquo: "\u2019", sbquo: "\u201A", bdquo: "\u201E",
  hellip: "…", mdash: "—", ndash: "–", bull: "•", middot: "·",
  euro: "€", pound: "£", yen: "¥", cent: "¢", curren: "¤",
  copy: "©", reg: "®", trade: "™", sect: "§", para: "¶", dagger: "†",
  times: "×", divide: "÷", plusmn: "±", frac12: "½", frac14: "¼", frac34: "¾",
  larr: "←", rarr: "→", harr: "↔", prime: "′", Prime: "″",
  ensp: " ", emsp: " ", thinsp: " ", shy: "", zwnj: "", zwj: "",
};

export type EnrichResult =
  | { status: "enriched"; chars: number }
  | { status: "already"; chars: number }
  | { status: "no_url" }
  | { status: "failed"; error: string };

/**
 * Un punto de código a carácter. Lo que no es imprimible se deja como estaba:
 * devolver un espacio borraba entidades legítimas y juntaba palabras.
 */
function codePoint(n: number, original: string): string {
  if (!Number.isFinite(n) || n < 32 || n > 0x10ffff) return original;
  try {
    return String.fromCodePoint(n);
  } catch {
    return original;
  }
}

/** Aplana HTML a texto legible. Sin dependencias: regex por bloques. */
export function extractMainText(html: string): string {
  let s = html;
  // Fuera bloques que nunca son contenido.
  s = s.replace(
    /<(script|style|noscript|svg|iframe|form|nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi,
    " ",
  );
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Si hay <article> o <main>, nos quedamos con el más largo (suele ser el cuerpo).
  const scoped: string[] = [];
  for (const tag of ["article", "main"]) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
    for (const m of s.match(re) ?? []) scoped.push(m);
  }
  if (scoped.length > 0) {
    s = scoped.sort((a, b) => b.length - a.length)[0];
  }
  // Saltos de línea en cierres de bloque para conservar párrafos.
  s = s.replace(/<\/(p|div|section|h[1-6]|li|blockquote|tr|br)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // Las etiquetas de dentro de la frase desaparecen sin dejar hueco; las
  // demás sí dejan un espacio, o se pegarían las celdas de una tabla.
  s = s.replace(new RegExp(`</?(?:${INLINE_TAGS})(?:\\s[^>]*)?>`, "gi"), "");
  s = s.replace(/<[^>]+>/g, " ");
  // Entidades HTML. El & literal se resuelve al final: hacerlo antes convierte
  // un "&amp;aacute;" escrito a propósito en la á que no era.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (m, hex) => codePoint(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, code) => codePoint(Number(code), m))
    .replace(/&([A-Za-z][A-Za-z0-9]{1,9});/g, (m, name) => NAMED_ENTITIES[name] ?? m)
    .replace(/&amp;/gi, "&");
  // Compactar espacios conservando párrafos.
  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return s.slice(0, MAX_CONTENT_CHARS);
}

/**
 * Enriquece un hallazgo: si aún no tiene `fullContent` y tiene URL, descarga
 * la página, extrae el texto y lo guarda. Nunca lanza: devuelve el resultado.
 */
export async function enrichFinding(findingId: string): Promise<EnrichResult> {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: { id: true, url: true, fullContent: true, summary: true },
  });
  if (!finding) return { status: "failed", error: "Hallazgo no encontrado" };
  if (finding.fullContent && finding.fullContent.trim().length > 0) {
    return { status: "already", chars: finding.fullContent.length };
  }
  if (!finding.url) return { status: "no_url" };

  try {
    const html = await fetchWithTimeout(finding.url);
    const text = extractMainText(html);
    if (text.length < MIN_USEFUL_CHARS) {
      return {
        status: "failed",
        error: `La página no expone texto útil (${text.length} chars — ¿paywall o contenido solo-JS?)`,
      };
    }
    await prisma.finding.update({
      where: { id: finding.id },
      data: { fullContent: text },
    });
    return { status: "enriched", chars: text.length };
  } catch (err) {
    return {
      status: "failed",
      error: err instanceof Error ? err.message.slice(0, 200) : "Error de descarga",
    };
  }
}

/**
 * Enriquece varios hallazgos en paralelo, sin lanzar nunca. Pensado para los
 * disparadores automáticos (marcar interesante, promover a idea), donde el
 * enriquecimiento es deseable pero no puede bloquear ni romper la acción.
 */
export async function enrichFindingsBestEffort(
  ids: string[],
  cap = 10,
): Promise<void> {
  const batch = ids.slice(0, cap);
  const results = await Promise.allSettled(batch.map((id) => enrichFinding(id)));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled" && r.value.status === "failed") {
      console.warn(`[enrich] ${batch[i]}: ${r.value.error}`);
    }
  }
}
