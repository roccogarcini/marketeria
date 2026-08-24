import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { getDecryptedKey, getDecryptedKeyById, type ProviderType } from "./providers";
import type { AIRequest } from "./types";

export type APIResponse = {
  output: string;
  model: string;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
};

/**
 * Subconjunto de ProviderType que sí son LLMs y por tanto este módulo sabe
 * llamar. APIFY/YOUTUBE viven en la misma tabla sólo por compartir el
 * cifrado AES-256, pero no se invocan desde aquí.
 *
 * ZAI (GLM), DEEPSEEK y GEMINI son OpenAI-compatibles → se enrutan por el SDK
 * de OpenAI con su baseURL por defecto (overridable por proveedor).
 */
type LLMProviderType =
  | "OPENAI"
  | "ANTHROPIC"
  | "OPENROUTER"
  | "CUSTOM"
  | "ZAI"
  | "DEEPSEEK"
  | "GEMINI";

const DEFAULT_MODELS: Record<LLMProviderType, string> = {
  OPENAI: "gpt-4o-mini",
  ANTHROPIC: "claude-sonnet-4-6",
  OPENROUTER: "openai/gpt-4o-mini",
  CUSTOM: "gpt-4o-mini",
  ZAI: "glm-4.6",
  DEEPSEEK: "deepseek-chat",
  GEMINI: "gemini-2.5-flash",
};

/**
 * baseURL por defecto para proveedores OpenAI-compatibles que tienen un
 * endpoint fijo. Se usa sólo si el proveedor no trae `baseUrl` propio.
 */
const DEFAULT_BASE_URLS: Partial<Record<LLMProviderType, string>> = {
  OPENROUTER: "https://openrouter.ai/api/v1",
  ZAI: "https://api.z.ai/api/openai/v1",
  DEEPSEEK: "https://api.deepseek.com",
  // Endpoint OpenAI-compatible de la API Gemini (Google AI Studio).
  GEMINI: "https://generativelanguage.googleapis.com/v1beta/openai",
};

function pickProvider(req: AIRequest): ProviderType {
  return req.providerType ?? "OPENAI";
}

/**
 * Construye un cliente OpenAI-compatible para un proveedor (OpenAI, DeepSeek,
 * z.ai, OpenRouter, Custom) — usado por el chat agéntico (tool-calling).
 * Lanza para ANTHROPIC (usa otro formato de herramientas).
 */
export function openaiCompatClientFor(
  providerType: ProviderType,
  creds: { apiKey: string; baseUrl: string | null; model: string | null },
): { client: OpenAI; model: string } {
  const llmType = asLLMProvider(providerType);
  if (llmType === "ANTHROPIC") {
    throw new Error("ANTHROPIC no es compatible con el tool-calling OpenAI.");
  }
  const baseURL = creds.baseUrl ?? DEFAULT_BASE_URLS[llmType];
  const client = new OpenAI({ apiKey: creds.apiKey, baseURL });
  return { client, model: creds.model ?? DEFAULT_MODELS[llmType] };
}

function asLLMProvider(p: ProviderType): LLMProviderType {
  if (p === "APIFY" || p === "YOUTUBE" || p === "TAVILY") {
    throw new Error(
      `El provider ${p} no es un LLM y no puede usarse desde el router IA.`,
    );
  }
  return p;
}

/**
 * Llama a chat.completions tolerando las incompatibilidades de parámetros de
 * los modelos nuevos de OpenAI: rechazan `max_tokens` (piden
 * `max_completion_tokens`) y a veces `temperature` (solo aceptan el valor por
 * defecto). Reintenta ajustando únicamente el parámetro que el API declara no
 * soportar, así funciona con modelos viejos y nuevos sin hardcodear listas.
 */
export async function openaiChatCreate(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const body: Record<string, unknown> = { ...params };
  const send = () =>
    client.chat.completions.create(
      body as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    ) as Promise<OpenAI.Chat.Completions.ChatCompletion>;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await send();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        body.max_tokens !== undefined &&
        /max_tokens|max_completion_tokens/i.test(msg)
      ) {
        body.max_completion_tokens = body.max_tokens;
        delete body.max_tokens;
        continue;
      }
      if (body.temperature !== undefined && /temperature/i.test(msg)) {
        delete body.temperature;
        continue;
      }
      throw err;
    }
  }
  return send();
}

/**
 * Prueba que una API key de LLM funciona haciendo una completion mínima.
 * Lanza si la clave/modelo no responden. Para tipos no-LLM
 * (APIFY/YOUTUBE/TAVILY) usar sus validadores propios.
 */
export async function pingProvider(
  type: ProviderType,
  apiKey: string,
  baseUrl: string | null,
  defaultModel?: string | null,
): Promise<void> {
  const llmType = asLLMProvider(type); // lanza si no es LLM
  // El modelo configurado del proveedor manda: contra endpoints CUSTOM
  // (z.ai, LiteLLM…) el del mapa puede no existir y daría falso negativo.
  const model = defaultModel ?? DEFAULT_MODELS[llmType];
  if (type === "ANTHROPIC") {
    const client = new Anthropic({ apiKey, baseURL: baseUrl ?? undefined });
    await client.messages.create({
      model,
      max_tokens: 5,
      messages: [{ role: "user", content: "ping" }],
    });
    return;
  }
  const baseURL = baseUrl ?? DEFAULT_BASE_URLS[llmType];
  const client = new OpenAI({ apiKey, baseURL });
  await openaiChatCreate(client, {
    model,
    max_tokens: 5,
    messages: [{ role: "user", content: "ping" }],
  });
}

/**
 * Lista los modelos disponibles del proveedor llamando a su endpoint de
 * modelos con la API key (nunca hardcodeamos catálogos: así los modelos
 * nuevos aparecen solos). OpenAI-compatibles → GET {baseURL}/models;
 * Anthropic → GET /v1/models.
 */
export async function listProviderModels(
  type: ProviderType,
  apiKey: string,
  baseUrl: string | null,
): Promise<string[]> {
  const llmType = asLLMProvider(type); // lanza si no es LLM
  if (llmType === "ANTHROPIC") {
    const res = await fetch(
      `${baseUrl ?? "https://api.anthropic.com"}/v1/models?limit=100`,
      { headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" } },
    );
    if (!res.ok) throw new Error(`Anthropic /models: HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string")
      .sort();
  }
  if (llmType === "ZAI") {
    // El endpoint OpenAI-compat de z.ai no implementa /models (devuelve un
    // 200 con "404 NOT_FOUND" dentro). El catálogo vive en los endpoints
    // nativos, que dependen del tipo de clave:
    //   - API estándar     → paas/v4/models
    //   - GLM Coding Plan  → coding/paas/v4/models
    // Si el baseUrl del proveedor menciona "coding", vamos directos; si no,
    // probamos ambos en cascada (la clave solo autentica en el suyo).
    const candidates = baseUrl?.includes("coding")
      ? ["https://api.z.ai/api/coding/paas/v4/models"]
      : [
          "https://api.z.ai/api/paas/v4/models",
          "https://api.z.ai/api/coding/paas/v4/models",
        ];
    let lastError = "sin respuesta";
    for (const url of candidates) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string")
        .sort();
      if (ids.length > 0) return ids;
      lastError = "respuesta sin modelos";
    }
    throw new Error(`z.ai /models: ${lastError} (¿clave correcta? ¿plan estándar o coding?)`);
  }
  const baseURL = baseUrl ?? DEFAULT_BASE_URLS[llmType];
  const client = new OpenAI({ apiKey, baseURL });
  const ids: string[] = [];
  // El SDK pagina solo con for-await (OpenRouter devuelve 400+ modelos).
  for await (const m of client.models.list()) ids.push(m.id);
  return ids.sort();
}

export async function runAPI(
  userId: string,
  req: AIRequest,
): Promise<APIResponse> {
  // Instancia concreta (por id) tiene prioridad; si no, por tipo (primera activa).
  let providerType: ProviderType;
  let creds: { apiKey: string; baseUrl: string | null; model: string | null } | null;
  if (req.providerId) {
    const byId = await getDecryptedKeyById(userId, req.providerId);
    if (!byId) {
      throw new Error(
        "El proveedor asignado no existe, está inactivo o no es un LLM. Revisa /admin/proveedores.",
      );
    }
    providerType = byId.providerType;
    creds = { apiKey: byId.apiKey, baseUrl: byId.baseUrl, model: byId.model };
  } else {
    providerType = pickProvider(req);
    creds = await getDecryptedKey(userId, providerType);
    if (!creds) {
      throw new Error(
        `No hay proveedor LLM activo de tipo ${providerType}. Añádelo en /admin/proveedores.`,
      );
    }
  }

  const llmType = asLLMProvider(providerType);
  const model = req.model ?? creds.model ?? DEFAULT_MODELS[llmType];
  const temperature = req.temperature ?? 0.7;
  const maxTokens = req.maxTokens ?? 2000;

  if (providerType === "ANTHROPIC") {
    const client = new Anthropic({ apiKey: creds.apiKey, baseURL: creds.baseUrl ?? undefined });
    const resp = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: req.systemPrompt ?? undefined,
      messages: [{ role: "user", content: req.userPrompt }],
    });
    const output = resp.content
      .map((c) => (c.type === "text" ? c.text : ""))
      .join("");
    return {
      output,
      model,
      tokenUsage: {
        promptTokens: resp.usage.input_tokens,
        completionTokens: resp.usage.output_tokens,
        totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
      },
    };
  }

  // OPENAI / OPENROUTER / CUSTOM / ZAI / DEEPSEEK — todos compatibles con OpenAI SDK.
  // Prioridad: baseUrl del proveedor → baseURL por defecto del tipo → undefined (OpenAI).
  const baseURL = creds.baseUrl ?? DEFAULT_BASE_URLS[llmType];
  const client = new OpenAI({ apiKey: creds.apiKey, baseURL });
  const messages: { role: "system" | "user"; content: string }[] = [];
  if (req.systemPrompt) messages.push({ role: "system", content: req.systemPrompt });
  messages.push({ role: "user", content: req.userPrompt });
  const resp = await openaiChatCreate(client, {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  });
  return {
    output: resp.choices[0]?.message?.content ?? "",
    model,
    tokenUsage: resp.usage
      ? {
          promptTokens: resp.usage.prompt_tokens,
          completionTokens: resp.usage.completion_tokens,
          totalTokens: resp.usage.total_tokens,
        }
      : null,
  };
}
