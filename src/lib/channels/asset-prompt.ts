/**
 * Construcción compartida de prompts de adaptación a canal (fase ASSET).
 * La usan /api/produce y /api/assets/[id]/regenerate para que producir y
 * regenerar apliquen EXACTAMENTE la misma lógica:
 *   1. Agente asignado al canal (su prompt manda; el systemPrompt del canal,
 *      si existe, se añade como reglas específicas).
 *   2. systemPrompt propio del canal.
 *   3. Default genérico de adaptación.
 * Siempre con las reglas de veracidad anexadas.
 */

export const GROUNDING_RULES = [
  "REGLAS DE VERACIDAD (obligatorias):",
  "- Trabaja EXCLUSIVAMENTE con el material proporcionado (idea, material fuente, contenido original).",
  "- Nunca inventes datos, cifras, citas, nombres ni afirmaciones que no estén en ese material.",
  "- Si falta información para un punto, escríbelo como [FALTA: qué dato] en vez de rellenarlo.",
  "- Es mejor una pieza corta y veraz que una larga inventada.",
].join("\n");

export type ChannelForPrompt = {
  name: string;
  type: string;
  constraintsJson: string | null;
  templateMarkdown: string | null;
  systemPrompt: string | null;
  agent: {
    id: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
    isActive: boolean;
    // Modelo/proveedor asignados al agente (opcional): permiten que cada agente
    // corra con un LLM distinto. Ver resolveAgentModel.
    providerId?: string | null;
    modelId?: string | null;
    provider?: { providerType: string; isActive: boolean } | null;
  } | null;
};

export function buildAssetPrompts(
  channel: ChannelForPrompt,
  content: { title: string; body: string },
  extraInstructions?: string | null,
  /**
   * Versión actual de la pieza (solo al regenerar con correcciones): las
   * instrucciones se aplican SOBRE ella en vez de rehacer desde cero, para
   * que "cambia el título del slide 3" conserve el resto intacto.
   */
  currentVersion?: string | null,
  /** Bloque "Perfil de marca" (ver brandPromptBlock) — voz e identidad visual. */
  brandBlock?: string | null,
): {
  systemPrompt: string;
  userPrompt: string;
  agent: NonNullable<ChannelForPrompt["agent"]> | null;
} {
  const channelAgent = channel.agent?.isActive ? channel.agent : null;

  const systemPrompt = [
    channelAgent
      ? [
          channelAgent.systemPrompt,
          channel.systemPrompt &&
            `Reglas específicas del canal:\n${channel.systemPrompt}`,
        ]
          .filter(Boolean)
          .join("\n\n")
      : channel.systemPrompt
        ? channel.systemPrompt
        : [
            "Eres un redactor que adapta contenido a un canal concreto.",
            `Canal: ${channel.name} (${channel.type})`,
            channel.constraintsJson && `Restricciones: ${channel.constraintsJson}`,
            channel.templateMarkdown &&
              `Plantilla de referencia:\n${channel.templateMarkdown}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
    brandBlock,
    GROUNDING_RULES,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Con agente o prompt propio, el contexto del canal va explícito en el user
  // prompt; con el default genérico ya viene en el system.
  const channelContext =
    channelAgent || channel.systemPrompt
      ? [
          `Canal destino: ${channel.name} (${channel.type})`,
          channel.constraintsJson &&
            `Configuración del canal (JSON): ${channel.constraintsJson}`,
          channel.templateMarkdown &&
            `Notas adicionales:\n${channel.templateMarkdown}`,
        ]
          .filter(Boolean)
          .join("\n\n") + "\n\n"
      : "";

  const userPrompt =
    channelContext +
    [
      `Contenido original:\n# ${content.title}\n\n${content.body}`,
      currentVersion &&
        `\nVERSIÓN ACTUAL DE LA PIEZA (aplica las correcciones sobre esta versión, conservando intacto todo lo que no se pida cambiar):\n${currentVersion}`,
      extraInstructions &&
        `\nCORRECCIONES SOLICITADAS (prioridad máxima): ${extraInstructions}`,
      "",
      channel.type === "CAROUSEL"
        ? "Produce los ficheros HTML del carrusel según el formato indicado, separados por marcadores === slideN.html ===, más un copy.md al final con el caption de la publicación. Cada slide debe ser HTML autocontenido de 1080×1080 (se renderizará a PNG tal cual)."
        : `Adapta al canal ${channel.type}. Devuelve SOLO el markdown adaptado, sin explicaciones.`,
      "No añadas datos, cifras ni afirmaciones que no estén en el contenido original.",
    ]
      .filter(Boolean)
      .join("\n");

  return { systemPrompt, userPrompt, agent: channelAgent };
}
