import { prisma } from "@/lib/prisma";
import { decrypt, encrypt, maskSecret } from "@/lib/crypto";

/**
 * Tipos de proveedor soportados.
 * - OPENAI/ANTHROPIC/OPENROUTER/CUSTOM/ZAI/DEEPSEEK/GEMINI → providers de LLM
 *   (los usa el router IA). ZAI (GLM), DEEPSEEK y GEMINI son OpenAI-compatibles,
 *   con baseURL por defecto en `src/lib/ai/api.ts` (overridable por proveedor).
 * - APIFY/YOUTUBE/TAVILY → no son LLM, sólo aprovechan el patrón de cifrado
 *   AES-256 y la UI de admin para almacenar API keys de scrapers/búsqueda.
 *   Las funciones consumidoras filtran por providerType antes de invocar.
 *   TAVILY = motor de búsqueda web para la "Investigación IA".
 */
export type ProviderType =
  | "OPENAI"
  | "ANTHROPIC"
  | "OPENROUTER"
  | "CUSTOM"
  | "ZAI"
  | "DEEPSEEK"
  | "GEMINI"
  | "APIFY"
  | "YOUTUBE"
  | "TAVILY";

export type ProviderPublic = {
  id: string;
  providerType: ProviderType;
  displayName: string;
  baseUrl: string | null;
  defaultModel: string | null;
  isActive: boolean;
  isDefaultResearch: boolean;
  apiKeyMasked: string;
  createdAt: Date;
  updatedAt: Date;
};

function maskFromStored(storedCipher: string): string {
  try {
    return maskSecret(decrypt(storedCipher));
  } catch {
    return "•••••••";
  }
}

export async function listProviders(userId: string): Promise<ProviderPublic[]> {
  const rows = await prisma.lLMProvider.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    providerType: r.providerType as ProviderType,
    displayName: r.displayName,
    baseUrl: r.baseUrl,
    defaultModel: r.defaultModel,
    isActive: r.isActive,
    isDefaultResearch: r.isDefaultResearch,
    apiKeyMasked: maskFromStored(r.encryptedApiKey),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

export async function upsertProvider(
  userId: string,
  input: {
    providerType: ProviderType;
    displayName: string;
    apiKey: string;
    baseUrl?: string | null;
    defaultModel?: string | null;
    isActive?: boolean;
  },
): Promise<ProviderPublic> {
  const encrypted = encrypt(input.apiKey);
  // Upsert por NOMBRE (único por usuario): reguardar con el mismo nombre
  // actualiza la clave/config; un nombre nuevo crea otra instancia. Así puede
  // haber dos proveedores del mismo tipo (p. ej. "z.ai Coding" y "z.ai Estándar").
  const row = await prisma.lLMProvider.upsert({
    where: {
      userId_displayName: { userId, displayName: input.displayName },
    },
    create: {
      userId,
      providerType: input.providerType,
      displayName: input.displayName,
      encryptedApiKey: encrypted,
      baseUrl: input.baseUrl ?? null,
      defaultModel: input.defaultModel ?? null,
      isActive: input.isActive ?? true,
    },
    update: {
      displayName: input.displayName,
      encryptedApiKey: encrypted,
      baseUrl: input.baseUrl ?? null,
      defaultModel: input.defaultModel ?? null,
      isActive: input.isActive ?? true,
    },
  });
  return {
    id: row.id,
    providerType: row.providerType as ProviderType,
    displayName: row.displayName,
    baseUrl: row.baseUrl,
    defaultModel: row.defaultModel,
    isActive: row.isActive,
    isDefaultResearch: row.isDefaultResearch,
    apiKeyMasked: maskSecret(input.apiKey),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function deleteProvider(userId: string, id: string): Promise<void> {
  await prisma.lLMProvider.deleteMany({ where: { id, userId } });
}

export type LLMProviderType =
  | "OPENAI"
  | "ANTHROPIC"
  | "OPENROUTER"
  | "CUSTOM"
  | "ZAI"
  | "DEEPSEEK"
  | "GEMINI";

const LLM_TYPES: LLMProviderType[] = [
  "OPENAI",
  "ANTHROPIC",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
  "OPENROUTER",
  "CUSTOM",
];

/**
 * Lista los proveedores LLM activos del usuario, en orden de antigüedad.
 * Se usa para el fallback: si el preferido falla, se prueban los demás.
 */
export async function listActiveLLMProviders(
  userId: string,
): Promise<LLMProviderType[]> {
  const rows = await prisma.lLMProvider.findMany({
    where: { userId, isActive: true, providerType: { in: LLM_TYPES } },
    select: { providerType: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.providerType as LLMProviderType);
}

export type LLMProviderInstance = {
  id: string;
  providerType: LLMProviderType;
  displayName: string;
};

/**
 * Igual que listActiveLLMProviders pero devolviendo INSTANCIAS (id + tipo +
 * nombre), no solo tipos. Necesario cuando puede haber más de un proveedor del
 * mismo tipo (p. ej. dos z.ai) y el fallback/selección deben distinguirlos.
 */
export async function listActiveLLMProviderInstances(
  userId: string,
): Promise<LLMProviderInstance[]> {
  const rows = await prisma.lLMProvider.findMany({
    where: { userId, isActive: true, providerType: { in: LLM_TYPES } },
    select: { id: true, providerType: true, displayName: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    providerType: r.providerType as LLMProviderType,
    displayName: r.displayName,
  }));
}

/**
 * Marca un proveedor LLM como predeterminado para la Investigación IA.
 * Como máximo uno por usuario: pone el resto a false en la misma transacción.
 * Solo acepta tipos LLM y proveedores que pertenezcan al usuario.
 * Devuelve false si el proveedor no existe, no es del usuario o no es LLM.
 */
export async function setDefaultResearchProvider(
  userId: string,
  providerId: string,
): Promise<boolean> {
  const target = await prisma.lLMProvider.findFirst({
    where: { id: providerId, userId },
    select: { id: true, providerType: true },
  });
  if (!target || !LLM_TYPES.includes(target.providerType as LLMProviderType)) {
    return false;
  }
  await prisma.$transaction([
    prisma.lLMProvider.updateMany({
      where: { userId, isDefaultResearch: true },
      data: { isDefaultResearch: false },
    }),
    prisma.lLMProvider.update({
      where: { id: target.id },
      data: { isDefaultResearch: true },
    }),
  ]);
  return true;
}

/** Quita la marca de predeterminado a un proveedor del usuario. */
export async function clearDefaultResearchProvider(
  userId: string,
  providerId: string,
): Promise<void> {
  await prisma.lLMProvider.updateMany({
    where: { id: providerId, userId },
    data: { isDefaultResearch: false },
  });
}

/**
 * Tipo del proveedor LLM predeterminado del usuario para la Investigación IA,
 * o null si no hay ninguno marcado (o el marcado está inactivo). Lo usa el
 * modo "Automático" como primera opción antes del fallback.
 */
export async function getDefaultResearchProviderType(
  userId: string,
): Promise<LLMProviderType | null> {
  const row = await prisma.lLMProvider.findFirst({
    where: {
      userId,
      isActive: true,
      isDefaultResearch: true,
      providerType: { in: LLM_TYPES },
    },
    select: { providerType: true },
  });
  return row ? (row.providerType as LLMProviderType) : null;
}

/**
 * Obtiene la clave en claro de un provider activo.
 * SOLO para uso en el lado servidor (router IA). Nunca devolver al frontend.
 */
export async function getDecryptedKey(
  userId: string,
  providerType: ProviderType,
): Promise<{ apiKey: string; baseUrl: string | null; model: string | null } | null> {
  const row = await prisma.lLMProvider.findFirst({
    where: { userId, providerType, isActive: true },
  });
  if (!row) return null;
  return {
    apiKey: decrypt(row.encryptedApiKey),
    baseUrl: row.baseUrl,
    model: row.defaultModel,
  };
}

/**
 * Instancia z.ai preferida para la búsqueda web NATIVA: la estándar (baseUrl
 * sin "coding"), porque el GLM Coding Plan no admite la tool web_search. Si solo
 * hay z.ai de tipo coding devuelve null (la investigación caerá a Tavily).
 */
export async function getZaiStandardKey(
  userId: string,
): Promise<{ apiKey: string; baseUrl: string | null; model: string | null } | null> {
  const rows = await prisma.lLMProvider.findMany({
    where: { userId, providerType: "ZAI", isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const standard = rows.find((r) => !r.baseUrl?.includes("coding"));
  if (!standard) return null;
  return {
    apiKey: decrypt(standard.encryptedApiKey),
    baseUrl: standard.baseUrl,
    model: standard.defaultModel,
  };
}

/**
 * Como getDecryptedKey pero por INSTANCIA (id): resuelve una instancia concreta
 * de proveedor (necesario cuando hay varias del mismo tipo). Devuelve también
 * el providerType de la fila para que el router elija el SDK/baseURL correctos.
 * Solo instancias activas del propio usuario.
 */
export async function getDecryptedKeyById(
  userId: string,
  providerId: string,
): Promise<{
  apiKey: string;
  baseUrl: string | null;
  model: string | null;
  providerType: LLMProviderType;
} | null> {
  const row = await prisma.lLMProvider.findFirst({
    where: { id: providerId, userId, isActive: true },
  });
  if (!row || !LLM_TYPES.includes(row.providerType as LLMProviderType)) return null;
  return {
    apiKey: decrypt(row.encryptedApiKey),
    baseUrl: row.baseUrl,
    model: row.defaultModel,
    providerType: row.providerType as LLMProviderType,
  };
}
