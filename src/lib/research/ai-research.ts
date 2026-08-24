import OpenAI from "openai";
import { prisma } from "@/lib/prisma";
import {
  getDecryptedKey,
  getZaiStandardKey,
  getDefaultResearchProviderType,
  type ProviderType,
} from "@/lib/ai/providers";
import { openaiChatCreate } from "@/lib/ai/api";
import { execute, trackExecution } from "@/lib/ai/router";
import { BudgetExceededError } from "@/lib/ai/budget";
import { fetchWithRetry } from "@/lib/net/retry";
import { getTavilyKey, tavilySearch } from "./tavily";

/**
 * "Investigación IA": dado un brief en lenguaje natural, busca en la web y
 * devuelve hallazgos estructurados. Reemplaza la antigua vía CLI (agéntica)
 * por una vía 100% API e híbrida:
 *
 *   - Si el proveedor LLM tiene búsqueda web nativa (hoy OpenAI) → la usa
 *     directamente (un solo paso).
 *   - Si no (deepseek, z.ai/GLM, custom…) → busca con Tavily y el LLM
 *     configurado estructura los resultados en hallazgos.
 *
 * En ambos casos el LLM nunca inventa URLs: trabaja sobre resultados reales.
 */

export type ResearchFinding = {
  title: string;
  url: string | null;
  snippet: string | null;
  summary: string | null;
  author: string | null;
  publishedAt: Date | null;
};

type LLMType = "OPENAI" | "ANTHROPIC" | "OPENROUTER" | "CUSTOM" | "ZAI" | "DEEPSEEK" | "GEMINI";
const LLM_TYPES: LLMType[] = [
  "OPENAI",
  "ANTHROPIC",
  "OPENROUTER",
  "CUSTOM",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
];

/**
 * Proveedores con búsqueda web NATIVA por API:
 *   - OPENAI → modelos `*-search-preview`.
 *   - ZAI/GLM → herramienta `web_search` de Zhipu (endpoint nativo paas/v4).
 * Anthropic (web_search tool) y xAI/Grok (Live Search) se pueden añadir aquí;
 * el resto (deepseek, custom…) cae al motor Tavily.
 */
export function providerSupportsNativeSearch(p: ProviderType): boolean {
  return p === "OPENAI" || p === "ZAI";
}

// La búsqueda web nativa de z.ai (tool `web_search`) solo existe en la API
// ESTÁNDAR (`paas/v4`); el GLM Coding Plan (`coding/paas/v4`) la rechaza. Por
// eso la selección de credencial usa getZaiStandardKey (prefiere la estándar).
const ZAI_NATIVE_ENDPOINT = "https://api.z.ai/api/paas/v4/chat/completions";
const ZAI_NATIVE_MODEL = "glm-4.6";
const OPENAI_SEARCH_MODEL = "gpt-4o-mini-search-preview";

const JSON_INSTRUCTIONS = [
  "Devuelves ÚNICAMENTE un array JSON (sin markdown fence, sin explicación, sin texto previo o posterior).",
  "Cada item con esta forma exacta:",
  '{ "title": "string (máx 300)", "url": "string (URL absoluta real)",',
  '  "snippet": "string resumen de 1-2 frases (máx 500)",',
  '  "summary": "string más denso de 3-5 frases (opcional, máx 1500)",',
  '  "publishedAt": "fecha ISO 8601 (opcional, sólo si la conoces)",',
  '  "author": "string (opcional)" }',
  "Nunca inventes URLs ni datos. Si un campo no se conoce, usa null u omítelo.",
].join("\n");

/** Extrae el primer array JSON de la salida del LLM, tolerante a prosa/fences. */
function parseFindings(output: string): ResearchFinding[] {
  let arrayStr: string | null = null;
  const stripped = output
    .replace(/^[\s\S]*?```(?:json)?\s*/i, "")
    .replace(/\s*```[\s\S]*$/i, "")
    .trim();
  if (stripped.startsWith("[")) arrayStr = stripped;
  else {
    const start = output.indexOf("[");
    const end = output.lastIndexOf("]");
    if (start >= 0 && end > start) arrayStr = output.slice(start, end + 1);
  }
  if (!arrayStr) return [];

  let items: unknown;
  try {
    items = JSON.parse(arrayStr);
  } catch {
    return [];
  }
  if (!Array.isArray(items)) return [];

  const findings: ResearchFinding[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const title = typeof it.title === "string" ? it.title.slice(0, 300) : null;
    if (!title) continue;
    let publishedAt: Date | null = null;
    if (typeof it.publishedAt === "string") {
      const d = new Date(it.publishedAt);
      if (!isNaN(d.getTime())) publishedAt = d;
    }
    findings.push({
      title,
      url: typeof it.url === "string" ? it.url : null,
      snippet: typeof it.snippet === "string" ? it.snippet.slice(0, 500) : null,
      summary: typeof it.summary === "string" ? it.summary : null,
      author: typeof it.author === "string" ? it.author : null,
      publishedAt,
    });
  }
  return findings;
}

/** Proveedores LLM activos del usuario, en orden de antigüedad. */
async function listActiveLLMs(userId: string): Promise<LLMType[]> {
  const rows = await prisma.lLMProvider.findMany({
    where: { userId, isActive: true, providerType: { in: LLM_TYPES } },
    select: { providerType: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.providerType as LLMType);
}

/**
 * Orden en el que probar los proveedores:
 *   1. El preferido por el usuario (si está activo).
 *   2. Los que tienen búsqueda web nativa (OpenAI, z.ai) — pueden investigar solos.
 *   3. El resto de activos (necesitan Tavily para buscar).
 * Sin duplicados y respetando el orden de antigüedad dentro de cada grupo.
 */
function orderCandidates(active: LLMType[], preferred: LLMType | null): LLMType[] {
  const seen = new Set<LLMType>();
  const ordered: LLMType[] = [];
  const push = (t: LLMType) => {
    if (active.includes(t) && !seen.has(t)) {
      seen.add(t);
      ordered.push(t);
    }
  };
  if (preferred) push(preferred);
  for (const t of active) if (providerSupportsNativeSearch(t)) push(t);
  for (const t of active) push(t);
  return ordered;
}

type ChatMsg = { role: "system" | "user"; content: string };

// ── Actualidad ──────────────────────────────────────────────────────────────
// Los LLM no saben qué día es: sin fecha en el prompt, un brief de "julio
// 2026" se responde desde la memoria de entrenamiento (noticias de 2024).

/** Meses de antigüedad máxima por defecto para los hallazgos. */
export const RECENCY_DEFAULT_MONTHS = 6;

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * ¿El brief pide contenido histórico? Entonces no aplicamos filtro de
 * actualidad. Señales: vocabulario retrospectivo o años anteriores al actual.
 */
export function briefWantsHistory(brief: string): boolean {
  if (
    /(hist[óo]ric|retrospectiv|evoluci[óo]n|cronolog|or[íi]genes|desde\s+20\d\d|últim[oa]s?\s+\d+\s+años|comparativa\s+anual)/i.test(
      brief,
    )
  ) {
    return true;
  }
  const currentYear = new Date().getFullYear();
  const years = brief.match(/20\d\d/g)?.map(Number) ?? [];
  return years.some((y) => y < currentYear);
}

/**
 * Filtro de actualidad sobre los hallazgos parseados:
 *  - descarta los que tengan publishedAt anterior al corte (N meses);
 *  - descarta los sin fecha SI el resto sí trae fecha (si ninguno trae fecha
 *    no podemos juzgar y se conservan);
 *  - no aplica si el brief pide histórico.
 */
export function applyRecencyFilter(
  findings: ResearchFinding[],
  brief: string,
  maxAgeMonths: number,
): { kept: ResearchFinding[]; dropped: number } {
  if (findings.length === 0 || briefWantsHistory(brief)) {
    return { kept: findings, dropped: 0 };
  }
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - maxAgeMonths);
  const dated = findings.filter((f) => f.publishedAt !== null);
  if (dated.length === 0) return { kept: findings, dropped: 0 };
  const kept = dated.filter((f) => (f.publishedAt as Date) >= cutoff);
  return { kept, dropped: findings.length - kept.length };
}

/**
 * Query de búsqueda a partir del brief: los buscadores (Tavily) degradan con
 * queries larguísimas — recortamos en límite de palabra sin tocar el brief
 * que ve el LLM.
 */
function searchQueryFromBrief(brief: string, maxChars = 400): string {
  const trimmed = brief.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const cut = trimmed.slice(0, maxChars);
  return cut.slice(0, cut.lastIndexOf(" ") > 200 ? cut.lastIndexOf(" ") : maxChars);
}

/**
 * Agente "investigador" (slug reservado) si existe y está activo: su prompt
 * orienta la búsqueda y la criba hacia lo relevante para la marca del usuario,
 * y su id permite atribuirle el consumo en /admin/consumo ("por agente").
 */
async function investigadorAgent(): Promise<{ id: string; systemPrompt: string } | null> {
  const agent = await prisma.agent.findFirst({
    where: { slug: "investigador", isActive: true },
    select: { id: true, systemPrompt: true },
  });
  return agent ?? null;
}

function researchMessages(
  brief: string,
  maxItems: number,
  agentPrompt: string | null,
  opts: { maxAgeMonths?: number; strictRetry?: boolean } = {},
): ChatMsg[] {
  const months = opts.maxAgeMonths ?? RECENCY_DEFAULT_MONTHS;
  const history = briefWantsHistory(brief);
  return [
    {
      role: "system",
      content:
        (agentPrompt ? agentPrompt + "\n\n" : "") +
        "Eres un investigador de contenido. Busca en la web información real, reciente y verificable sobre el brief.\n" +
        `FECHA ACTUAL: ${todayISO()}. Tu memoria de entrenamiento está DESACTUALIZADA respecto a esta fecha: ` +
        "DEBES usar la búsqueda web para obtener la información; NUNCA respondas desde tu memoria.\n" +
        (history
          ? ""
          : `Solo interesan piezas publicadas en los últimos ${months} meses; descarta lo anterior.\n`) +
        "Incluye SIEMPRE la fecha de publicación real (publishedAt) de cada hallazgo cuando la fuente la muestre.\n" +
        "Si el brief es largo, extrae primero sus términos clave y busca con ellos.\n" +
        JSON_INSTRUCTIONS,
    },
    {
      role: "user",
      content:
        (opts.strictRetry
          ? "TU RESPUESTA ANTERIOR NO ERA VÁLIDA (no contenía el array JSON de hallazgos o venía vacía). Ejecuta la búsqueda web y devuelve ÚNICAMENTE el array JSON.\n\n"
          : "") +
        `Brief de investigación:\n${brief}\n\n` +
        `Devuelve entre 3 y ${maxItems} hallazgos. Responde solo con el array JSON.`,
    },
  ];
}

/**
 * Resultado de una búsqueda nativa: además de los hallazgos, el modelo y el
 * consumo de tokens que reporta el proveedor, para poder registrarlo en
 * AIExecution (trackExecution) y que el gasto salga en /admin/consumo.
 */
type NativeSearchResult = {
  findings: ResearchFinding[];
  model: string;
  tokenUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null;
};

/** Búsqueda web nativa de OpenAI (modelos `*-search-preview`). */
async function openaiNativeSearch(
  apiKey: string,
  baseUrl: string | null,
  brief: string,
  maxItems: number,
  agentPrompt: string | null,
  opts: { maxAgeMonths?: number; strictRetry?: boolean } = {},
): Promise<NativeSearchResult> {
  const client = new OpenAI({ apiKey, baseURL: baseUrl ?? undefined });
  // El modelo search-preview rechaza `max_tokens` (pide max_completion_tokens)
  // y `temperature`: openaiChatCreate reintenta ajustándolos.
  const resp = await openaiChatCreate(client, {
    model: OPENAI_SEARCH_MODEL,
    max_tokens: 3000,
    messages: researchMessages(brief, maxItems, agentPrompt, opts),
  });
  return {
    findings: parseFindings(resp.choices[0]?.message?.content ?? ""),
    model: resp.model ?? OPENAI_SEARCH_MODEL,
    tokenUsage: resp.usage
      ? {
          promptTokens: resp.usage.prompt_tokens,
          completionTokens: resp.usage.completion_tokens,
          totalTokens: resp.usage.total_tokens,
        }
      : null,
  };
}

/**
 * Búsqueda web nativa de z.ai/GLM vía la herramienta `web_search` de Zhipu.
 * Es un tool propio (no formato OpenAI), así que usamos el endpoint nativo
 * paas/v4 con fetch directo en vez del SDK de OpenAI.
 */
async function zaiNativeSearch(
  apiKey: string,
  brief: string,
  maxItems: number,
  agentPrompt: string | null,
  opts: { maxAgeMonths?: number; strictRetry?: boolean } = {},
): Promise<NativeSearchResult> {
  const ctl = new AbortController();
  // La búsqueda web de z.ai (search_std + generación) puede ser lenta.
  const t = setTimeout(() => ctl.abort(), 180_000);
  try {
    // Siempre el endpoint estándar: el de coding no admite `web_search` y para
    // esas claves ni siquiera llegamos aquí (se filtran antes → Tavily).
    const res = await fetchWithRetry(
      ZAI_NATIVE_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: ZAI_NATIVE_MODEL,
          max_tokens: 3000,
          messages: researchMessages(brief, maxItems, agentPrompt, opts),
          tools: [
            {
              type: "web_search",
              web_search: {
                enable: true,
                search_engine: "search_std",
                // search_query explícita: fuerza la ejecución de la búsqueda
                // (sin ella, GLM a veces responde de memoria sin invocar el tool)
                // y evita que un brief largo degrade la query.
                search_query: searchQueryFromBrief(brief),
                search_result: true,
              },
            },
          ],
        }),
        signal: ctl.signal,
      },
      { label: "z.ai web_search" },
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`z.ai web_search ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    return {
      findings: parseFindings(data.choices?.[0]?.message?.content ?? ""),
      model: data.model ?? ZAI_NATIVE_MODEL,
      tokenUsage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : null,
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("z.ai tardó demasiado en responder (búsqueda web lenta). Reintenta o usa Tavily.");
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

export type AIResearchResult = {
  findings: ResearchFinding[];
  via: "native" | "tavily";
  /** Proveedor que finalmente completó la investigación. */
  provider: LLMType;
  /**
   * Proveedor que se pidió (elección explícita en el lanzador o el marcado por
   * defecto). null si no había preferencia y se usó el orden natural. Si difiere
   * de `provider`, hubo fallback y la UI lo avisa.
   */
  requestedProvider: LLMType | null;
  /** Errores de los proveedores intentados antes del que funcionó (para avisar). */
  attempts: string[];
};

export async function runAIResearch(params: {
  userId: string;
  brief: string;
  maxItems?: number;
  /** Proveedor LLM elegido por el usuario. "AUTO"/null/desconocido → automático. */
  preferredProvider?: string | null;
  /** Antigüedad máxima de los hallazgos en meses (default 6). No aplica si el brief pide histórico. */
  maxAgeMonths?: number;
  /** Fuente que dispara la investigación: se guarda en AIExecution para atribuir el consumo. */
  sourceId?: string;
}): Promise<AIResearchResult> {
  const maxItems = Math.max(3, Math.min(12, params.maxItems ?? 8));
  const maxAgeMonths = Math.max(1, Math.min(24, params.maxAgeMonths ?? RECENCY_DEFAULT_MONTHS));
  const active = await listActiveLLMs(params.userId);
  if (active.length === 0) {
    throw new Error(
      "No hay proveedor LLM activo. Añade uno en /admin/proveedores para usar la investigación IA.",
    );
  }

  // 1) La elección explícita del usuario en el lanzador manda. 2) Si eligió
  // "Automático", respetamos el proveedor marcado como predeterminado en
  // /admin/proveedores. 3) Si tampoco hay, cae al orden natural (nativos primero).
  const pref = params.preferredProvider as LLMType | undefined;
  let preferred =
    pref && LLM_TYPES.includes(pref) && active.includes(pref) ? pref : null;
  if (!preferred) {
    const def = await getDefaultResearchProviderType(params.userId);
    if (def && active.includes(def)) preferred = def;
  }
  const candidates = orderCandidates(active, preferred);

  // Agente "investigador" (si está activo): orienta búsqueda y criba.
  const investigador = await investigadorAgent();
  const agentPrompt = investigador?.systemPrompt ?? null;

  // Metadatos comunes de todas las llamadas al LLM de esta investigación, para
  // que su coste quede contabilizado en AIExecution (→ /admin/consumo).
  const tracking = {
    phase: "RESEARCH",
    agentId: investigador?.id ?? null,
    refType: "source",
    refId: params.sourceId,
  } as const;

  // Registro de lo intentado, para un mensaje de error accionable si nada sale.
  const attempts: string[] = [];

  // ── 1) Búsqueda web NATIVA: probamos en orden cada proveedor capaz ──────
  // Así, si el preferido/primero se queda sin cuota (429), saldo o timeout,
  // el siguiente proveedor nativo (p. ej. z.ai tras OpenAI) toma el relevo.
  for (const provider of candidates) {
    if (!providerSupportsNativeSearch(provider)) continue;
    // Para z.ai la búsqueda nativa exige el plan ESTÁNDAR (el Coding Plan no
    // admite web_search). Si hay varias instancias z.ai, elegimos la estándar;
    // si solo hay coding, no intentamos nativa (caerá a Tavily).
    const creds =
      provider === "ZAI"
        ? await getZaiStandardKey(params.userId)
        : await getDecryptedKey(params.userId, provider);
    if (!creds) {
      attempts.push(
        provider === "ZAI"
          ? "ZAI (nativa): no hay una instancia z.ai estándar (solo Coding Plan, que no permite web_search); se buscará con Tavily."
          : `${provider}: sin credencial activa`,
      );
      continue;
    }
    try {
      // Cada intento (incluido el reintento estricto) es una llamada al LLM y
      // deja su propia fila en AIExecution.
      const search = (strictRetry: boolean) =>
        trackExecution(
          {
            ...tracking,
            model: provider === "ZAI" ? ZAI_NATIVE_MODEL : OPENAI_SEARCH_MODEL,
          },
          async () => {
            const r =
              provider === "ZAI"
                ? await zaiNativeSearch(creds.apiKey, params.brief, maxItems, agentPrompt, {
                    maxAgeMonths,
                    strictRetry,
                  })
                : await openaiNativeSearch(
                    creds.apiKey,
                    creds.baseUrl,
                    params.brief,
                    maxItems,
                    agentPrompt,
                    { maxAgeMonths, strictRetry },
                  );
            return { value: r.findings, model: r.model, tokenUsage: r.tokenUsage };
          },
        );

      let out = await search(false);
      // Respuesta sin array JSON parseable (briefs largos suelen provocar que
      // el modelo conteste en prosa): UN reintento con instrucción correctiva.
      // Nunca tratamos el vacío como éxito silencioso.
      if (out.length === 0) out = await search(true);
      if (out.length === 0) {
        attempts.push(
          `${provider} (nativa): la respuesta no contenía hallazgos parseables tras 2 intentos (sin array JSON o vacío)`,
        );
        continue;
      }
      // Filtro de actualidad: si todo lo devuelto es viejo, el proveedor
      // respondió de memoria en vez de buscar — probamos el siguiente.
      const rec = applyRecencyFilter(out, params.brief, maxAgeMonths);
      if (rec.kept.length === 0) {
        attempts.push(
          `${provider} (nativa): los ${out.length} hallazgos eran anteriores a ${maxAgeMonths} meses o sin fecha — respuesta de memoria, no de búsqueda web actual`,
        );
        continue;
      }
      return {
        findings: rec.kept.slice(0, maxItems),
        via: "native",
        provider,
        requestedProvider: preferred,
        attempts: [...attempts],
      };
    } catch (err) {
      // El tope mensual no es un fallo del proveedor: probar el siguiente daría
      // exactamente el mismo bloqueo y, peor, seguiríamos hasta gastar créditos
      // de Tavily. Cortamos aquí y el mensaje del tope sube tal cual.
      if (err instanceof BudgetExceededError) throw err;
      const m = err instanceof Error ? err.message : "error desconocido";
      console.error(`[ai-research] búsqueda nativa de ${provider} falló:`, m);
      attempts.push(`${provider} (nativa): ${m.slice(0, 160)}`);
    }
  }

  // ── 2) Vía Tavily + LLM: buscamos con Tavily y cualquiera de tus LLM ─────
  // estructura los resultados reales. Cubre a DeepSeek/Anthropic/etc. y sirve
  // de respaldo si la búsqueda nativa falló.
  const tavilyKey = await getTavilyKey(params.userId);
  if (tavilyKey) {
    try {
      const wantsHistory = briefWantsHistory(params.brief);
      const results = await tavilySearch(tavilyKey, searchQueryFromBrief(params.brief), {
        maxResults: Math.min(15, maxItems * 2),
        searchDepth: "advanced",
        // Recencia en el propio buscador (salvo briefs históricos).
        ...(wantsHistory ? {} : { daysBack: maxAgeMonths * 30 }),
      });
      if (results.length === 0) {
        // Nunca "0 hallazgos" en silencio: que el caller sepa por qué.
        attempts.push(
          `Tavily: la búsqueda no devolvió resultados para el brief${wantsHistory ? "" : ` en los últimos ${maxAgeMonths} meses`}`,
        );
        throw new Error("__tavily_empty__");
      }
      const resultsBlock = results
        .map(
          (r, i) =>
            `[${i + 1}] ${r.title}\nURL: ${r.url}${r.publishedDate ? `\nFecha: ${r.publishedDate}` : ""}\n${r.content}`,
        )
        .join("\n\n");

      // Probamos estructurar con cada candidato hasta que uno responda:
      // nunca reusamos a ciegas el que acaba de fallar arriba, y un parse
      // vacío cuenta como fallo (no como éxito con 0).
      for (const provider of candidates) {
        try {
          // Vía execute() (y no runAPI directo): es lo único que escribe en
          // AIExecution, así que esta llamada —la más cara de la vía Tavily—
          // deja de ser gasto invisible. execute() no lanza: devuelve
          // status ERROR, que convertimos en throw para que lo recoja el catch
          // de este bucle, como hacía runAPI.
          const r = await execute(params.userId, {
            ...tracking,
            providerType: provider,
            systemPrompt:
              (agentPrompt ? agentPrompt + "\n\n" : "") +
              "Eres un investigador de contenido. Estructuras resultados de búsqueda web reales en hallazgos.\n" +
              `FECHA ACTUAL: ${todayISO()}.\n` +
              "Usa SOLO la información y URLs de los resultados proporcionados. Nunca inventes URLs ni datos.\n" +
              "Incluye la fecha de publicación (publishedAt) cuando el resultado la muestre.\n" +
              JSON_INSTRUCTIONS,
            userPrompt:
              `Brief de investigación:\n${params.brief}\n\n` +
              `Resultados de búsqueda web (fuente de verdad):\n${resultsBlock}\n\n` +
              `Selecciona y resume los ${maxItems} más relevantes al brief. Responde solo con el array JSON.`,
            maxTokens: 3000,
          });
          if (r.status === "ERROR") {
            throw new Error(r.error ?? "el proveedor no devolvió respuesta");
          }
          const parsed = parseFindings(r.output);
          if (parsed.length === 0) {
            attempts.push(
              `${provider} (Tavily): la respuesta de estructuración no contenía el array JSON de hallazgos`,
            );
            continue;
          }
          const rec = applyRecencyFilter(parsed, params.brief, maxAgeMonths);
          if (rec.kept.length === 0) {
            attempts.push(
              `${provider} (Tavily): los ${parsed.length} hallazgos estructurados eran anteriores a ${maxAgeMonths} meses o sin fecha`,
            );
            continue;
          }
          return {
            findings: rec.kept.slice(0, maxItems),
            via: "tavily",
            // execute() tiene su propio fallback entre proveedores: el que
            // reportamos es el que realmente respondió, no el candidato pedido.
            provider: (r.provider as LLMType | null) ?? provider,
            requestedProvider: preferred,
            attempts: [...attempts],
          };
        } catch (err) {
          const m = err instanceof Error ? err.message : "error desconocido";
          console.error(`[ai-research] estructurar con ${provider} (Tavily) falló:`, m);
          attempts.push(`${provider} (Tavily): ${m.slice(0, 160)}`);
        }
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : "error desconocido";
      // "__tavily_empty__" ya dejó su explicación en attempts.
      if (m !== "__tavily_empty__") {
        console.error("[ai-research] búsqueda Tavily falló:", m);
        attempts.push(`Tavily: ${m.slice(0, 160)}`);
      }
    }
  }

  // ── 3) Nada funcionó: error claro con lo intentado y la mejor sugerencia ─
  const hasNative = candidates.some((p) => providerSupportsNativeSearch(p));
  const hint = tavilyKey
    ? " · Revisa el saldo/cuota de tus proveedores."
    : hasNative
      ? " · Alternativa: añade un proveedor TAVILY en /admin/proveedores (plan gratuito) como buscador de respaldo."
      : " · Ninguno de tus proveedores busca en la web por sí solo (solo OpenAI y z.ai lo hacen). Activa OpenAI o z.ai, o añade un proveedor TAVILY en /admin/proveedores.";
  throw new Error(
    `No se pudo completar la investigación IA. Intentos: ${attempts.join(" · ") || "ninguno"}.${hint}`,
  );
}
