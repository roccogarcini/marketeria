import { prisma } from "@/lib/prisma";

/**
 * Contexto de marca para prompts de IA, construido desde el BrandProfile
 * singleton. Lo usan la producción de contenido (texto) y la adaptación a
 * canal / diseño de carruseles (fase ASSET).
 *
 * El logo NUNCA pasa por el LLM (un data URI base64 desperdiciaría miles de
 * tokens y el modelo lo corrompería): el prompt de diseño instruye a usar el
 * marcador __BRAND_LOGO__ y el servidor lo sustituye por la imagen real al
 * guardar (applyBrandLogo). Al iterar sobre una versión existente se hace la
 * sustitución inversa (stripBrandLogo) para no enviar el base64 al modelo.
 */

export const BRAND_LOGO_PLACEHOLDER = "__BRAND_LOGO__";

export type BrandContext = {
  /** Bloque para generación de TEXTO (sin instrucción de logo). */
  textBlock: string | null;
  /** Bloque para DISEÑO/adaptación a canal (con instrucción de logo si hay). */
  designBlock: string | null;
  /** Data URI del logo (png/jpeg/webp) o null. */
  logoDataUri: string | null;
};

export async function getBrandContext(): Promise<BrandContext> {
  const brand = await prisma.brandProfile.findUnique({ where: { id: "default" } });
  if (!brand) return { textBlock: null, designBlock: null, logoDataUri: null };

  const common = [
    `Marca: ${brand.name}`,
    brand.tone && `Tono: ${brand.tone}`,
    brand.voice && `Voz: ${brand.voice}`,
    brand.audience && `Audiencia: ${brand.audience}`,
    brand.editorialLinesJson && `Líneas editoriales: ${brand.editorialLinesJson}`,
    brand.mustAvoid && `Evitar: ${brand.mustAvoid}`,
    brand.visualIdentity &&
      `Identidad visual (aplícala en cualquier diseño: colores, tipografía, estilo, firma): ${brand.visualIdentity}`,
  ].filter(Boolean) as string[];

  const logoDataUri = brand.logoDataUri?.trim() || null;
  // El logo es OPT-IN: está disponible pero NO se incluye por defecto — solo
  // si el usuario lo pide (instrucciones/correcciones), o lo piden las reglas
  // del canal o el prompt del agente.
  const logoLine = logoDataUri
    ? `Logo de la marca DISPONIBLE (opcional): NO lo incluyas por defecto. SOLO si las instrucciones del usuario, las reglas del canal o tu propio prompt piden incluir el logo, insértalo con <img src="${BRAND_LOGO_PLACEHOLDER}" alt="logo"> (el sistema sustituye ${BRAND_LOGO_PLACEHOLDER} por la imagen real; NO escribas otra cosa en src) — discreto, pequeño (36-56px).`
    : null;

  const textBlock =
    common.length > 0 ? "Perfil de marca:\n" + common.join("\n") : null;
  const designLines = logoLine ? [...common, logoLine] : common;
  const designBlock =
    designLines.length > 0 ? "Perfil de marca:\n" + designLines.join("\n") : null;

  return { textBlock, designBlock, logoDataUri };
}

/** Sustituye el marcador del logo por el data URI real (al guardar). */
export function applyBrandLogo(body: string, logoDataUri: string | null): string {
  if (!logoDataUri || !body.includes(BRAND_LOGO_PLACEHOLDER)) return body;
  return body.split(BRAND_LOGO_PLACEHOLDER).join(logoDataUri);
}

/** Sustitución inversa: quita el base64 antes de enviar una versión al LLM. */
export function stripBrandLogo(body: string, logoDataUri: string | null): string {
  if (!logoDataUri || !body.includes(logoDataUri)) return body;
  return body.split(logoDataUri).join(BRAND_LOGO_PLACEHOLDER);
}

/** Compat: bloque simple de marca (texto). Usa getBrandContext si necesitas logo. */
export async function brandPromptBlock(): Promise<string | null> {
  return (await getBrandContext()).textBlock;
}
