/**
 * Validación del output de un carrusel: los modelos débiles a veces ponen el
 * marcador y luego texto plano en vez de documentos HTML. Detectarlo permite
 * reintentar con feedback en vez de guardar una pieza inservible.
 */

/** null si el output es un carrusel válido; si no, descripción del problema. */
export function carouselOutputProblem(output: string): string | null {
  const slideMarkers =
    output.match(/^===\s*slide[\w.-]*\.html\s*===\s*$/gim) ?? [];
  if (slideMarkers.length < 2) {
    return `solo hay ${slideMarkers.length} marcador(es) "=== slideN.html ===" — un carrusel necesita al menos 2 slides`;
  }
  // Un documento por slide: exigimos un <!DOCTYPE html> por marcador (la
  // plantilla del agente lo manda). Así cazamos el caso mixto de un slide
  // HTML válido y otro con texto plano.
  const htmlDocs = output.match(/<!DOCTYPE\s+html/gi) ?? [];
  if (htmlDocs.length === 0) {
    return "los ficheros slideN.html no contienen documentos HTML (deben empezar por <!DOCTYPE html>)";
  }
  if (htmlDocs.length < slideMarkers.length) {
    return `hay ${slideMarkers.length} marcadores de slide pero solo ${htmlDocs.length} documento(s) HTML — cada slide debe ser un documento HTML completo`;
  }
  return null;
}

/** Instrucción correctiva que se añade al reintento tras un output inválido. */
export function carouselRetryInstruction(problem: string): string {
  return (
    `\n\nTU RESPUESTA ANTERIOR FUE INVÁLIDA: ${problem}. ` +
    "Repite la pieza cumpliendo el formato EXACTO: tras cada marcador `=== slideN.html ===` va EXCLUSIVAMENTE un documento HTML completo que empieza por `<!DOCTYPE html>` " +
    "(html,body de 1080×1080 px, CSS en <style>, sin recursos externos). Nada de texto suelto ni markdown fuera de `=== copy.md ===`."
  );
}
