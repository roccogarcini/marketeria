import { prisma } from "@/lib/prisma";
import {
  getDecryptedKey,
  getDecryptedKeyById,
  listActiveLLMProviders,
  getDefaultResearchProviderType,
  type LLMProviderType,
} from "@/lib/ai/providers";
import { openaiCompatClientFor } from "@/lib/ai/api";
import { AGENT_TOOLS, WRITE_TOOLS, executeAgentTool } from "@/lib/ai/agent-tools";

/**
 * Chat agéntico: el agente puede invocar herramientas (ver/registrar datos de
 * la app) mediante tool-calling OpenAI-compatible. Solo proveedores
 * compatibles (OpenAI, DeepSeek, z.ai, OpenRouter, Custom); si el único activo
 * es ANTHROPIC, devuelve null y el caller usa el chat normal (sin herramientas).
 */

const MAX_ITERATIONS = 6; // vueltas de tool-calling antes de forzar respuesta

export type AgentChatResult = {
  output: string;
  provider: LLMProviderType;
  model: string;
  toolsUsed: string[];
  wrote: boolean;
  inputTokens: number;
  outputTokens: number;
};

/** Primer proveedor activo compatible con tool-calling (no Anthropic). */
async function pickToolProvider(userId: string): Promise<LLMProviderType | null> {
  const active = await listActiveLLMProviders(userId);
  const compat = active.filter((p) => p !== "ANTHROPIC");
  if (compat.length === 0) return null;
  const def = await getDefaultResearchProviderType(userId);
  if (def && def !== "ANTHROPIC" && compat.includes(def)) return def;
  return compat[0];
}

export async function runAgentChat(
  userId: string,
  params: {
    systemPrompt: string;
    history: { role: "user" | "assistant"; content: string }[];
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
    agentId?: string | null;
    /** Proveedor/modelo asignados al agente en su ficha (tienen preferencia). */
    agentProviderId?: string | null;
    agentModel?: string | null;
  },
): Promise<AgentChatResult | null> {
  // Preferencia: el proveedor asignado al agente. Si es Anthropic (sin
  // tool-calling OpenAI), se devuelve null y el caller usa el chat normal —
  // que respeta el proveedor/modelo del agente vía execute().
  let provider: LLMProviderType;
  let creds: { apiKey: string; baseUrl: string | null; model: string | null };
  let modelOverride: string | null = null;
  const byAgent = params.agentProviderId
    ? await getDecryptedKeyById(userId, params.agentProviderId)
    : null;
  if (byAgent) {
    if (byAgent.providerType === "ANTHROPIC") return null;
    provider = byAgent.providerType;
    creds = byAgent;
    modelOverride = params.agentModel ?? null;
  } else {
    const picked = await pickToolProvider(userId);
    if (!picked) return null;
    provider = picked;
    const def = await getDecryptedKey(userId, provider);
    if (!def) return null;
    creds = def;
  }

  let client, model;
  try {
    ({ client, model } = openaiCompatClientFor(provider, creds));
  } catch {
    return null;
  }
  if (modelOverride) model = modelOverride;

  const started = Date.now();
  const execution = await prisma.aIExecution.create({
    data: {
      phase: "CHAT",
      agentId: params.agentId ?? null,
      executionMode: "API",
      status: "RUNNING",
      modelUsed: model,
    },
  });

  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        params.systemPrompt +
        "\n\nTienes HERRAMIENTAS para consultar y registrar datos reales de la app " +
        "(ideas, hallazgos, creaciones, canales, marca). Úsalas cuando el usuario " +
        "pregunte por lo que hay registrado o pida guardar algo. ANTES de CREAR nada " +
        "(crear_idea/crear_hallazgo/crear_creacion), confírmalo con el usuario en tu " +
        "respuesta salvo que te lo haya pedido explícitamente. No inventes datos: si " +
        "no tienes la información, consúltala con una herramienta.",
    },
    ...params.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: params.userMessage },
  ];

  const toolsUsed: string[] = [];
  let wrote = false;
  let inputTokens = 0;
  let outputTokens = 0;
  let output = "";

  try {
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const resp = await client.chat.completions.create({
        model,
        messages: messages as never,
        tools: AGENT_TOOLS,
        temperature: params.temperature ?? 0.5,
        max_tokens: params.maxTokens ?? 2000,
      });
      inputTokens += resp.usage?.prompt_tokens ?? 0;
      outputTokens += resp.usage?.completion_tokens ?? 0;
      const msg = resp.choices[0]?.message;
      if (!msg) break;

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // El mensaje del asistente con las tool_calls debe ir al historial.
        messages.push(msg as unknown as Record<string, unknown>);
        for (const tc of msg.tool_calls) {
          if (tc.type !== "function") continue;
          const name = tc.function.name;
          toolsUsed.push(name);
          if (WRITE_TOOLS.has(name)) wrote = true;
          const result = await executeAgentTool(userId, name, tc.function.arguments);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
        continue; // otra vuelta con los resultados de las herramientas
      }

      output = msg.content ?? "";
      break;
    }
    if (!output) {
      output =
        "He consultado la información pero no he podido cerrar una respuesta. Reformula la pregunta, por favor.";
    }

    await prisma.aIExecution.update({
      where: { id: execution.id },
      data: {
        status: "SUCCESS",
        durationMs: Date.now() - started,
        inputTokens,
        outputTokens,
      },
    });

    return { output, provider, model, toolsUsed, wrote, inputTokens, outputTokens };
  } catch (err) {
    await prisma.aIExecution.update({
      where: { id: execution.id },
      data: {
        status: "ERROR",
        durationMs: Date.now() - started,
        errorMessage: err instanceof Error ? err.message.slice(0, 300) : "Error",
        inputTokens,
        outputTokens,
      },
    });
    throw err;
  }
}
