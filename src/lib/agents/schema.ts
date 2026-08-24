import { z } from "zod";

/**
 * Validación compartida de los campos editables de un agente de chat.
 * La usan el PATCH de sesión (/api/agents/[id]), el PATCH de la API externa
 * (/api/v1/agents/[id]) y la tool MCP update_agent_prompt — misma regla en
 * los tres sitios, definida una sola vez.
 */
export const agentPatchShape = {
  name: z.string().min(1).max(120).optional(),
  role: z.string().min(1).max(120).optional(),
  systemPrompt: z.string().min(1).max(20_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
  icon: z.string().max(40).nullable().optional(),
  isActive: z.boolean().optional(),
  // Proveedor/modelo por agente. providerId null → usa el orden global.
  providerId: z.string().uuid().nullable().optional(),
  modelId: z.string().max(120).nullable().optional(),
};

export const agentPatchSchema = z.object(agentPatchShape);

export type AgentPatch = z.infer<typeof agentPatchSchema>;

/** Tipos de proveedor que son LLM (asignables a un agente). */
export const LLM_PROVIDER_TYPES = [
  "OPENAI",
  "ANTHROPIC",
  "OPENROUTER",
  "CUSTOM",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
];
