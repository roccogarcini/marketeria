/**
 * Cálculo determinista de viralidad y potencialidad para una investigación,
 * a partir exclusivamente de sus métricas públicas (sin IA).
 *
 * Ambos scores están en el rango [0, 1] y se exponen como porcentaje en UI.
 *
 * Viralidad (cómo de contagioso es el contenido):
 *   - share rate = shares / reach        · peso ×15 (shares son el signal más fuerte)
 *   - engagement rate = (likes+comments+shares) / reach · peso ×5
 *   - comment rate = comments / max(likes, 1) · peso ×0.3 (conversación)
 *
 * Potencialidad (valor para nuestro contenido futuro):
 *   - reach normalizado (logarítmico) · peso 0.5 — audiencia probada
 *   - engagement rate normalizado    · peso 0.3 — calidad de respuesta
 *   - frescura (decae a 30 días)      · peso 0.2 — si está caliente convierte más
 *
 * Notas internas (reach=0): virality=null, potential=0.5 (neutral — el valor
 * editorial está ahí aunque no tenga métricas públicas).
 */

export type FindingStats = {
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  publishedAt: Date | string | null;
};

export type FindingScores = {
  virality: number | null; // 0..1 o null si no hay métricas
  potential: number; // 0..1 siempre
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function daysSince(d: Date | string | null): number | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 86_400_000;
}

export function computeFindingScores(s: FindingStats): FindingScores {
  const reach = s.reach ?? 0;
  const likes = s.likes ?? 0;
  const comments = s.comments ?? 0;
  const shares = s.shares ?? 0;

  // Sin métricas externas (nota interna): virality no aplica; potencialidad
  // se deja neutra porque el contenido puede ser muy valioso editorialmente.
  if (reach <= 0) {
    return { virality: null, potential: 0.5 };
  }

  const engagement = likes + comments + shares;
  const engagementRate = engagement / reach; // típico 0.01..0.10
  const shareRate = shares / reach;
  const commentRatio = comments / Math.max(likes, 1);

  const virality = clamp01(
    shareRate * 15 + engagementRate * 5 + commentRatio * 0.3,
  );

  // Potencialidad combina reach (log), engagement y frescura.
  const reachNorm = clamp01(Math.log10(reach + 1) / 5); // 100k → 1
  const engagementNorm = clamp01(engagementRate * 10);
  const age = daysSince(s.publishedAt);
  const freshnessNorm =
    age === null ? 0.5 : clamp01(1 - age / 30); // 0 días→1, 30 días→0

  const potential = clamp01(
    reachNorm * 0.5 + engagementNorm * 0.3 + freshnessNorm * 0.2,
  );

  return { virality, potential };
}

/** Devuelve un entero 0..100 a partir de un score 0..1 (o null → null). */
export function pct(n: number | null): number | null {
  if (n === null) return null;
  return Math.round(n * 100);
}
