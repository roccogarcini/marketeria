/**
 * Parser compartido de bodies de assets carrusel.
 *
 * Reglas: detectamos 5 formatos posibles (en orden de preferencia):
 *   1. Markers `=== slideN.html ===` (formato oficial pedido al LLM)
 *   2. Comentarios `<!-- SLIDE N -->` (la variante que más usa el LLM)
 *   3. Cabeceras markdown `## Slide N` con bloque ```html dentro
 *   4. Documento HTML monolítico con N bloques `<section class="slide">`
 *      (el LLM lo emite a veces cuando "olvida" los marcadores)
 *   5. Fallback bundle.md
 *
 * Es deliberadamente isomórfico — no usa nada de DOM ni de Node — para poder
 * reutilizarse desde el componente React y desde la ruta server-side de
 * export a PNG.
 */

export type CarouselFile = {
  name: string;
  content: string;
};

/**
 * Envuelve un fragmento HTML (div, body parcial) en un documento HTML
 * completo apto para iframe/Puppeteer, con margen 0 y fondo negro.
 */
export function wrapSlideDocument(fragment: string, extraHead = ""): string {
  if (/<html[\s>]/i.test(fragment)) return fragment;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#0a0a0a;overflow:hidden}</style>${extraHead}</head><body>${fragment}</body></html>`;
}

/**
 * Extrae el contenido íntegro del <head> de un documento HTML para poder
 * reinyectarlo en cada slide cuando partimos un doc monolítico. Devuelve ""
 * si no encuentra <head>. No usa DOM — regex tolerante a atributos.
 */
function extractHead(doc: string): string {
  const headMatch = /<head[^>]*>([\s\S]*?)<\/head>/i.exec(doc);
  return headMatch ? headMatch[1] : "";
}

/**
 * Encuentra todos los `<section ...>...</section>` de primer nivel en un
 * documento. Implementa un mini-balanceo de `<section>` anidados para no
 * cortar a la mitad uno que contenga otra section por dentro.
 */
function extractSections(doc: string): string[] {
  const OPEN = /<section\b[^>]*>/gi;
  const out: string[] = [];
  let openMatch: RegExpExecArray | null;
  while ((openMatch = OPEN.exec(doc)) !== null) {
    const start = openMatch.index;
    // Avanzar contando aperturas/cierres a partir del cierre del tag de apertura.
    let depth = 1;
    let cursor = OPEN.lastIndex;
    const TAGS = /<\/?section\b[^>]*>/gi;
    TAGS.lastIndex = cursor;
    let tag: RegExpExecArray | null;
    while ((tag = TAGS.exec(doc)) !== null) {
      if (tag[0].startsWith("</")) {
        depth--;
        if (depth === 0) {
          const end = TAGS.lastIndex;
          out.push(doc.slice(start, end));
          OPEN.lastIndex = end;
          cursor = end;
          break;
        }
      } else {
        depth++;
      }
    }
    if (depth !== 0) break; // HTML malformado: paramos para no entrar en bucle
  }
  return out;
}

export function parseCarouselFiles(body: string): CarouselFile[] {
  if (!body) return [];

  let clean = body.trim();
  clean = clean.replace(/^```(?:html|markdown|md)?\s*\n?/i, "");
  clean = clean.replace(/\n?```\s*$/i, "");

  // Formato 1: === filename ===
  const FILE_MARKER = /^===\s*([\w.-]+)\s*===\s*$/gm;
  const fileMatches: Array<{ name: string; start: number; headerEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = FILE_MARKER.exec(clean)) !== null) {
    fileMatches.push({ name: m[1], start: m.index, headerEnd: m.index + m[0].length });
  }
  if (fileMatches.length > 0) {
    const files: CarouselFile[] = [];
    for (let i = 0; i < fileMatches.length; i++) {
      const cur = fileMatches[i];
      const next = fileMatches[i + 1];
      const content = clean.slice(cur.headerEnd, next ? next.start : undefined).trim();
      const isHtml = cur.name.toLowerCase().endsWith(".html");
      files.push({
        name: cur.name,
        content: isHtml ? wrapSlideDocument(content) : content,
      });
    }
    return files;
  }

  // Formato 2: <!-- SLIDE N -->
  const SLIDE_MARKER = /<!--\s*SLIDE\s+(\d+)[^>]*-->/gim;
  const slideMatches: Array<{ idx: number; start: number; headerEnd: number }> = [];
  while ((m = SLIDE_MARKER.exec(clean)) !== null) {
    slideMatches.push({ idx: parseInt(m[1], 10), start: m.index, headerEnd: m.index + m[0].length });
  }
  if (slideMatches.length > 0) {
    const files: CarouselFile[] = [];
    for (let i = 0; i < slideMatches.length; i++) {
      const cur = slideMatches[i];
      const next = slideMatches[i + 1];
      const fragment = clean.slice(cur.headerEnd, next ? next.start : undefined).trim();
      files.push({
        name: `slide${String(cur.idx).padStart(2, "0")}.html`,
        content: wrapSlideDocument(fragment),
      });
    }
    return files;
  }

  // Formato 3: ## Slide N + bloque ```html
  const H2_SLIDE = /^#{2,4}\s+Slide\s+(\d+)(?:\s*[—\-:]\s*[^\n]*)?\s*$/gim;
  const h2Matches: Array<{ idx: number; start: number; headerEnd: number }> = [];
  while ((m = H2_SLIDE.exec(clean)) !== null) {
    h2Matches.push({ idx: parseInt(m[1], 10), start: m.index, headerEnd: m.index + m[0].length });
  }
  if (h2Matches.length > 0) {
    const files: CarouselFile[] = [];
    for (let i = 0; i < h2Matches.length; i++) {
      const cur = h2Matches[i];
      const next = h2Matches[i + 1];
      const section = clean.slice(cur.headerEnd, next ? next.start : undefined).trim();
      const fence = /```(?:html|svg|xml)?\s*\n?([\s\S]*?)\n?```/i.exec(section);
      const raw = fence ? fence[1].trim() : section;
      files.push({
        name: `slide${String(cur.idx).padStart(2, "0")}.html`,
        content: wrapSlideDocument(raw),
      });
    }
    return files;
  }

  // Formato 4: documento HTML monolítico con N <section> (con class="slide"
  // o sin ella, da igual). Extraemos cada section, reaprovechamos el <head>
  // original (estilos, fuentes, vars CSS) y emitimos un doc por slide.
  if (/<!DOCTYPE html|<html[\s>]/i.test(clean)) {
    const sections = extractSections(clean);
    if (sections.length >= 2) {
      const head = extractHead(clean);
      // Reset margin/padding del body en cada slide para que la section ocupe
      // limpio el 1080×1080 sin offsets accidentales del CSS heredado.
      const extraHead = head + "<style>body{margin:0;padding:0}</style>";
      return sections.map((sec, i) => ({
        name: `slide${String(i + 1).padStart(2, "0")}.html`,
        content: wrapSlideDocument(sec, extraHead),
      }));
    }
  }

  return [{ name: "bundle.md", content: clean }];
}
