const LLM_TYPES = ["OPENAI", "ANTHROPIC", "OPENROUTER", "CUSTOM", "ZAI", "DEEPSEEK", "GEMINI"];

/**
 * Traduce la configuración de proveedor/modelo de un agente a los campos que
 * entiende execute(): la INSTANCIA de proveedor (por id) + un model concreto.
 *
 * Reglas:
 *  - Solo se fuerza el proveedor si está asignado Y activo (uno inactivo se
 *    ignora → se usa el orden por defecto).
 *  - El modelId solo se aplica junto a su proveedor: un modelId pertenece al
 *    catálogo de UN proveedor, así que nunca lo mandamos "suelto" (evita enviar
 *    p. ej. "glm-5.2" a OpenAI).
 *  - Se usa el id de instancia (no el tipo) para poder distinguir dos
 *    proveedores del mismo tipo (p. ej. z.ai coding vs estándar).
 *  - Sin configuración → objeto vacío = comportamiento por defecto de siempre.
 */
export type AgentModelConfig = {
  providerId?: string | null;
  modelId?: string | null;
  provider?: { providerType: string; isActive: boolean } | null;
} | null | undefined;

export type AgentModelOverride = {
  providerId?: string;
  model?: string;
};

export function resolveAgentModel(agent: AgentModelConfig): AgentModelOverride {
  const provider = agent?.provider;
  if (!agent?.providerId || !provider || !provider.isActive) return {};
  // Solo proveedores LLM (no APIFY/YOUTUBE/TAVILY, que comparten tabla).
  if (!LLM_TYPES.includes(provider.providerType)) return {};
  return {
    providerId: agent.providerId,
    model: agent.modelId ?? undefined,
  };
}

/** Campos mínimos a seleccionar del agente para resolver su modelo. */
export const AGENT_MODEL_SELECT = {
  providerId: true,
  modelId: true,
  provider: { select: { providerType: true, isActive: true } },
} as const;
