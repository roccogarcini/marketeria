/**
 * Máquina de estados de las ideas editoriales — fuente única de verdad,
 * compartida por el endpoint interno (/api/ideas/[id]/status) y las
 * operaciones de la API externa (REST /api/v1 y MCP).
 *
 * Transiciones permitidas:
 *   DRAFT     → PROPOSED | APPROVED
 *   PROPOSED  → APPROVED | REJECTED | DRAFT
 *   APPROVED  → ARCHIVED | PROPOSED
 *   REJECTED  → ARCHIVED | PROPOSED
 *   ARCHIVED  → PROPOSED    (recuperar idea archivada)
 */

export const IDEA_STATUSES = [
  "DRAFT",
  "PROPOSED",
  "APPROVED",
  "REJECTED",
  "ARCHIVED",
] as const;

export type IdeaStatus = (typeof IDEA_STATUSES)[number];

// Fase de Ideas simplificada a Promocionadas ↔ Aprobadas desde UI,
// mantenemos compatibilidad con los demás estados existentes.
export const IDEA_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PROPOSED", "APPROVED"],
  PROPOSED: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: ["ARCHIVED", "PROPOSED"],
  REJECTED: ["ARCHIVED", "PROPOSED"],
  ARCHIVED: ["PROPOSED"],
};

export function canTransitionIdeaStatus(from: string, to: string): boolean {
  return (IDEA_STATUS_TRANSITIONS[from] ?? []).includes(to);
}
