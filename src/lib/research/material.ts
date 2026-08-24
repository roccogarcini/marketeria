/**
 * Nivel de materia prima de un hallazgo — el "semáforo" anti-invención.
 * Módulo puro (sin prisma) para poder usarlo en componentes cliente.
 *
 *   FULL       🟢 hay texto fuente amplio (artículo/post completo) → producir seguro.
 *   PARTIAL    🟡 hay resumen/snippet pero no el contenido completo → enriquecer antes.
 *   TITLE_ONLY 🔴 solo titular → producir generará contenido genérico/inventado.
 */

export type MaterialLevel = "FULL" | "PARTIAL" | "TITLE_ONLY";

/** Umbral a partir del cual consideramos que hay "contenido completo". */
const FULL_THRESHOLD = 1200;

export function materialLevel(f: {
  fullContent?: string | null;
  summary?: string | null;
  snippet?: string | null;
}): MaterialLevel {
  const full = f.fullContent?.trim().length ?? 0;
  const summary = f.summary?.trim().length ?? 0;
  const snippet = f.snippet?.trim().length ?? 0;
  if (full >= FULL_THRESHOLD || summary >= FULL_THRESHOLD) return "FULL";
  if (full > 0 || summary > 0 || snippet > 0) return "PARTIAL";
  return "TITLE_ONLY";
}

/** El mejor texto fuente disponible del hallazgo, por orden de riqueza. */
export function bestMaterial(f: {
  fullContent?: string | null;
  summary?: string | null;
  snippet?: string | null;
}): string | null {
  return f.fullContent?.trim() || f.summary?.trim() || f.snippet?.trim() || null;
}

export const MATERIAL_LABELS: Record<
  MaterialLevel,
  { label: string; emoji: string; hint: string }
> = {
  FULL: {
    label: "Material completo",
    emoji: "🟢",
    hint: "Hay texto fuente amplio: la IA trabajará sobre contenido real.",
  },
  PARTIAL: {
    label: "Material parcial",
    emoji: "🟡",
    hint: "Solo hay un resumen/extracto. Enriquece el hallazgo para traer el contenido completo.",
  },
  TITLE_ONLY: {
    label: "Solo titular",
    emoji: "🔴",
    hint: "No hay texto fuente: producir así generará contenido genérico. Enriquece primero.",
  },
};
