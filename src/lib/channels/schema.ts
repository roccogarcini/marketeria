import { z } from "zod";

/**
 * Validación compartida de los campos editables de un canal.
 * La usan el PATCH de sesión (/api/channels/[id]) con el shape completo, y el
 * PATCH de la API externa (/api/v1/channels/[id]) + la tool MCP
 * update_channel_prompt con el subconjunto de "prompt editorial"
 * (systemPrompt, templateMarkdown, constraintsJson) — misma regla en todos.
 */
export const channelPatchShape = {
  name: z.string().min(1).max(120).optional(),
  type: z
    .enum(["LINKEDIN", "BLOG", "NEWSLETTER", "INSTAGRAM", "TWITTER", "CAROUSEL", "CUSTOM"])
    .optional(),
  constraintsJson: z.string().max(20_000).nullable().optional(),
  templateMarkdown: z.string().max(40_000).nullable().optional(),
  systemPrompt: z.string().max(40_000).nullable().optional(),
  // Agente asignado: su systemPrompt manda al generar la creación del canal.
  agentId: z.string().max(128).nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
};

export const channelPatchSchema = z.object(channelPatchShape);

export type ChannelPatch = z.infer<typeof channelPatchSchema>;

/** Subconjunto editable desde fuera (API externa y MCP): el prompt del canal. */
export const channelPromptPatchShape = {
  systemPrompt: channelPatchShape.systemPrompt,
  templateMarkdown: channelPatchShape.templateMarkdown,
  constraintsJson: channelPatchShape.constraintsJson,
};

export const channelPromptPatchSchema = z.object(channelPromptPatchShape);
