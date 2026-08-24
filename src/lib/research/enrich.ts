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

export type EnrichResult =
  | { status: "enriched"; chars: number }
  | { status: "already"; chars: number }
  | { status: "no_url" }
  | { status: "failed"; error: string };

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
  // Fuera el resto de tags.
  s = s.replace(/<[^>]+>/g, " ");
  // Entidades HTML básicas.
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return n > 31 && n < 65536 ? String.fromCharCode(n) : " ";
    });
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
