import path from "path";
import fs from "fs/promises";

/**
 * Descompone el output de un asset carrusel en ficheros separados usando los
 * marcadores "=== <filename> ===". Guarda en storage/carousels/<assetId>/.
 * Lo usan producir y regenerar para mantener los ficheros en disco al día
 * (el export a PNG lee del body del asset, pero los ficheros sirven de
 * inspección/depuración).
 */
export async function writeCarouselFiles(assetId: string, rawOutput: string) {
  const dir = path.join(process.cwd(), "storage", "carousels", assetId);
  await fs.mkdir(dir, { recursive: true });

  // Partimos por marcadores. Admitimos variaciones tipo "=== slide1.html ===".
  const MARKER = /^===\s*([\w.-]+)\s*===\s*$/gm;
  const matches: Array<{ name: string; start: number; headerEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = MARKER.exec(rawOutput)) !== null) {
    matches.push({ name: m[1], start: m.index, headerEnd: m.index + m[0].length });
  }
  if (matches.length === 0) {
    // Sin marcadores: guardamos el output crudo como bundle.md para que el
    // usuario lo pueda revisar y copiar a mano.
    await fs.writeFile(path.join(dir, "bundle.md"), rawOutput, "utf-8");
    return;
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const content = rawOutput
      .slice(cur.headerEnd, next ? next.start : undefined)
      .trim();
    await fs.writeFile(path.join(dir, cur.name), content, "utf-8");
  }
}
