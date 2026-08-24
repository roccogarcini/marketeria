import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { fetchWithRetry } from "@/lib/net/retry";

/**
 * Cliente central de Apify. Lee el token cifrado del LLMProvider
 * (providerType=APIFY) del usuario actual y llama al endpoint síncrono
 * `run-sync-get-dataset-items` que ejecuta un Actor y devuelve directamente
 * los items del dataset (sin polling).
 *
 * Docs: https://docs.apify.com/api/v2/act-runs-post
 */

const APIFY_TIMEOUT_MS = 120_000;

export type ApifyRunInput = Record<string, unknown>;

/** Obtiene el token Apify descifrado del usuario. null si no está configurado. */
export async function getApifyToken(userId: string): Promise<string | null> {
  const provider = await prisma.lLMProvider.findFirst({
    where: { userId, providerType: "APIFY", isActive: true },
    select: { encryptedApiKey: true },
  });
  if (!provider) return null;
  try {
    return decrypt(provider.encryptedApiKey);
  } catch {
    return null;
  }
}

/** Valida un token Apify contra /v2/users/me. Devuelve el username si es válido. */
export async function validateApifyToken(
  token: string,
): Promise<{ valid: true; username: string } | { valid: false; error: string }> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10_000);
    const res = await fetch("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (res.status === 401) {
      return { valid: false, error: "Token inválido." };
    }
    if (!res.ok) {
      return { valid: false, error: `Apify: HTTP ${res.status}` };
    }
    const data = (await res.json()) as { data?: { username?: string } };
    return { valid: true, username: data.data?.username ?? "?" };
  } catch (err) {
    return {
      valid: false,
      error:
        err instanceof Error ? err.message : "Error de red contra Apify.",
    };
  }
}

export type ApifyActorRef = {
  id: string;
  name: string; // "username~actorName" (id preferido para ejecutar)
  title: string; // título legible
};

/**
 * Lista los Actors de la cuenta del usuario (los que ha creado). Los actores
 * públicos del store no se listan aquí; para esos, el usuario pega su id.
 */
export async function listApifyActors(token: string): Promise<ApifyActorRef[]> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch("https://api.apify.com/v2/acts?limit=500&desc=false", {
      headers: { Authorization: `Bearer ${token}` },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Apify /acts: HTTP ${res.status}`);
    const data = (await res.json()) as {
      data?: { items?: Array<{ id?: string; name?: string; username?: string; title?: string }> };
    };
    return (data.data?.items ?? [])
      .filter((a) => a.id && a.name)
      .map((a) => ({
        id: a.username && a.name ? `${a.username}~${a.name}` : (a.id as string),
        name: a.name as string,
        title: a.title || a.name || (a.id as string),
      }));
  } finally {
    clearTimeout(t);
  }
}

export type ApifyField = {
  key: string;
  title: string;
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  editor?: string;
  description?: string;
  default?: unknown;
  prefill?: unknown;
  enumValues?: string[];
  enumTitles?: string[];
  required: boolean;
};

export type ApifyActorSchema = {
  title: string;
  fields: ApifyField[];
};

/**
 * Recupera y normaliza el input schema de un actor. Resuelve el build por
 * defecto y lee su `inputSchema`. Defensivo: si algo no viene, devuelve null.
 */
export async function getApifyActorSchema(
  token: string,
  actorId: string,
): Promise<ApifyActorSchema | null> {
  const safeActor = actorId.replace("/", "~");
  const headers = { Authorization: `Bearer ${token}` };
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    // 1) Actor → localizar el buildId por defecto (taggedBuilds.latest).
    const actRes = await fetch(`https://api.apify.com/v2/acts/${safeActor}`, {
      headers,
      signal: ctl.signal,
    });
    if (!actRes.ok) throw new Error(`Apify actor: HTTP ${actRes.status}`);
    const act = (await actRes.json()) as {
      data?: {
        taggedBuilds?: Record<string, { buildId?: string }>;
        defaultRunOptions?: { build?: string };
      };
    };
    const buildId =
      act.data?.taggedBuilds?.latest?.buildId ??
      Object.values(act.data?.taggedBuilds ?? {})[0]?.buildId;
    if (!buildId) return null;

    // 2) Build → inputSchema (viene como string JSON o como objeto).
    const buildRes = await fetch(`https://api.apify.com/v2/acts/${safeActor}/builds/${buildId}`, {
      headers,
      signal: ctl.signal,
    });
    if (!buildRes.ok) throw new Error(`Apify build: HTTP ${buildRes.status}`);
    const build = (await buildRes.json()) as { data?: { inputSchema?: unknown } };
    const raw = build.data?.inputSchema;
    const schema = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!schema || typeof schema !== "object") return null;

    return normalizeApifySchema(schema as Record<string, unknown>);
  } finally {
    clearTimeout(t);
  }
}

function normalizeApifySchema(schema: Record<string, unknown>): ApifyActorSchema {
  const title = typeof schema.title === "string" ? schema.title : "Configuración del actor";
  const required = Array.isArray(schema.required)
    ? (schema.required as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const fields: ApifyField[] = Object.entries(props).map(([key, p]) => {
    const rawType = typeof p.type === "string" ? p.type : "string";
    const type: ApifyField["type"] =
      rawType === "integer" || rawType === "number" || rawType === "boolean" || rawType === "array" || rawType === "object"
        ? (rawType as ApifyField["type"])
        : "string";
    return {
      key,
      title: typeof p.title === "string" ? p.title : key,
      type,
      editor: typeof p.editor === "string" ? p.editor : undefined,
      description: typeof p.description === "string" ? p.description : undefined,
      default: p.default,
      prefill: p.prefill,
      enumValues: Array.isArray(p.enum)
        ? (p.enum as unknown[]).map((x) => String(x))
        : undefined,
      enumTitles: Array.isArray(p.enumTitles)
        ? (p.enumTitles as unknown[]).map((x) => String(x))
        : undefined,
      required: required.includes(key),
    };
  });
  return { title, fields };
}

/**
 * Mapeo GENÉRICO de un item de actor arbitrario a un Finding. Heurística por
 * nombres de campo habituales (los actores custom no tienen mapItem propio).
 * Además del texto completo (fullContent, cap 20k) intenta rescatar las
 * métricas de engagement por los nombres más comunes entre actores; si el
 * actor no las devuelve quedan null sin romper.
 */
export function mapGenericApifyItem(raw: unknown): {
  title: string;
  url: string | null;
  snippet: string | null;
  summary: string | null;
  fullContent: string | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    }
    return null;
  };
  const firstNum = (...vals: unknown[]): number | null => {
    for (const v of vals) {
      const n = num(v);
      if (n !== null) return n;
    }
    return null;
  };
  const url =
    str(o.url) ?? str(o.link) ?? str(o.postUrl) ?? str(o.tweetUrl) ?? str(o.videoUrl) ?? null;
  const text =
    str(o.fullText) ?? str(o.text) ?? str(o.caption) ?? str(o.content) ?? str(o.description) ?? str(o.message) ?? undefined;
  const title =
    str(o.title) ??
    str(o.name) ??
    str(o.headline) ??
    (text ? text.slice(0, 120) : undefined) ??
    (url ? url : undefined);
  if (!title) return null;
  return {
    title: title.slice(0, 300),
    url,
    snippet: text ? text.slice(0, 500) : null,
    summary: text ?? null,
    fullContent: text ? text.slice(0, 20_000) : null,
    reach: firstNum(o.viewCount, o.viewsCount, o.views, o.playCount, o.impressions, o.reach),
    likes: firstNum(o.likesCount, o.likeCount, o.likes, o.diggCount, o.numLikes),
    comments: firstNum(o.commentsCount, o.commentCount, o.comments, o.replyCount, o.numComments),
    shares: firstNum(o.sharesCount, o.shareCount, o.shares, o.retweetCount, o.numShares),
  };
}

/**
 * Ejecuta un Actor y devuelve los items del dataset resultante.
 * Usa el endpoint síncrono — bloquea hasta que el Actor termina.
 */
export async function runApifyActor(
  token: string,
  actorId: string,
  input: ApifyRunInput,
  opts: { maxItems?: number } = {},
): Promise<unknown[]> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), APIFY_TIMEOUT_MS);
  try {
    const qs = new URLSearchParams();
    if (opts.maxItems) qs.set("limit", String(opts.maxItems));
    // actorId puede venir como "user~actor" (preferible) o "userId/actorId".
    const safeActor = actorId.replace("/", "~");
    const url = `https://api.apify.com/v2/acts/${safeActor}/run-sync-get-dataset-items${
      qs.size ? `?${qs.toString()}` : ""
    }`;
    // El token va SIEMPRE en cabecera, nunca en la query: una URL con el token
    // se queda escrita en los logs de cualquier proxy intermedio, en las trazas
    // y en los mensajes de error que incluyen la URL. Es además lo que ya hacía
    // el resto de este cliente (validate/list/schema).
    //
    // Con reintentos: Apify devuelve 429 (límite de runs simultáneos del plan)
    // y 5xx puntuales; sin reintento se perdía la fuente entera del cron.
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(input),
        signal: ctl.signal,
      },
      { label: `Apify ${actorId}` },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Apify ${actorId} → HTTP ${res.status}: ${text.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) {
      throw new Error("Apify no devolvió un array de items.");
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
