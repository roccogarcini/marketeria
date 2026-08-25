import type OpenAI from "openai";
import {
  listFindingsOp,
  listIdeasOp,
  listChannelsOp,
  listAssetsOp,
  getAssetOp,
  getBrandOp,
  createIdeaOp,
  createFindingOp,
  createCreationOp,
} from "@/lib/api/operations";

/**
 * Herramientas que los agentes del chat pueden invocar (tool-calling) para
 * VER y REGISTRAR datos de la app. Formato OpenAI (compatible con OpenAI,
 * DeepSeek, z.ai, OpenRouter, Custom). Las de lectura son seguras; las de
 * escritura crean registros reales (el agente ejecuta con el usuario del chat,
 * respetando sus permisos).
 */

export const AGENT_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "listar_ideas",
      description:
        "Lista las ideas editoriales registradas en Marketería. status opcional: PROPOSED | APPROVED | REJECTED | ARCHIVED.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_hallazgos",
      description:
        "Lista los hallazgos de investigación. status opcional: NEW | SENT_TO_ANALYSIS | DISCARDED | PROMOTED.",
      parameters: {
        type: "object",
        properties: {
          status: { type: "string" },
          limit: { type: "integer", minimum: 1, maximum: 50 },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_creaciones",
      description:
        "Lista las creaciones (piezas por canal) con su estado, tamaño y un extracto. NO devuelve el texto completo: para leer una pieza entera usa ver_creacion con su id.",
      parameters: {
        type: "object",
        properties: { limit: { type: "integer", minimum: 1, maximum: 30 } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "ver_creacion",
      description:
        "Devuelve el cuerpo completo de UNA creación por su id (recortado si es enorme, p. ej. un carrusel). Usa antes listar_creaciones para saber qué id pedir.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          maxChars: { type: "integer", minimum: 500, maximum: 20000 },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "listar_canales",
      description: "Lista los canales de publicación activos (id, nombre, tipo).",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "ver_marca",
      description:
        "Devuelve el perfil de marca: nombre, tono, voz, audiencia, líneas editoriales, qué evitar e identidad visual.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_idea",
      description:
        "Registra una nueva idea editorial. Úsalo cuando el usuario quiera guardar una idea. approved=true (por defecto) la deja lista para producir.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          angle: { type: "string" },
          rationale: { type: "string" },
          approved: { type: "boolean" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_hallazgo",
      description: "Registra un hallazgo/nota en la bandeja de investigación.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
          summary: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_creacion",
      description:
        "Registra una creación ya redactada (un copy, una newsletter…). channelType opcional: tipo (NEWSLETTER, LINKEDIN…) o nombre del canal.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          channelType: { type: "string" },
        },
        required: ["title", "body"],
      },
    },
  },
];

/** Nombres de herramientas de escritura (crean registros). */
export const WRITE_TOOLS = new Set(["crear_idea", "crear_hallazgo", "crear_creacion"]);

/**
 * Foto compacta de la app para el chat SIN herramientas — cuando el proveedor
 * no soporta tool-calling (Anthropic) o rechaza el parámetro `tools` (z.ai):
 * marca + últimos hallazgos e ideas + canales, con textos recortados para no
 * inflar el prompt. Así el agente siempre "ve" la app aunque no tenga tools.
 */
export async function buildAppContextSnapshot(): Promise<string> {
  const clip = (s: string | null | undefined, n: number) =>
    s ? (s.length > n ? `${s.slice(0, n)}…` : s) : null;
  const [brand, findings, ideas, channels] = await Promise.all([
    getBrandOp().catch(() => null),
    listFindingsOp({ limit: 15 }).catch(() => []),
    listIdeasOp({ limit: 15 }).catch(() => []),
    listChannelsOp().catch(() => []),
  ]);
  return JSON.stringify({
    marca: brand,
    hallazgos_recientes: findings.map((f) => ({
      titulo: clip(f.title, 140),
      resumen: clip(f.snippet ?? f.summary, 200),
      estado: f.status,
      fuente: f.source?.name ?? null,
      url: f.url,
    })),
    ideas_recientes: ideas.map((i) => ({
      titulo: clip(i.title, 140),
      angulo: clip(i.angle, 160),
      estado: i.status,
    })),
    canales: channels,
  });
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * Tope duro del resultado de UNA herramienta (caracteres, ~8k tokens).
 *
 * El resultado se queda en el historial y se reenvía en cada una de las
 * iteraciones del bucle de tool-calling: lo que aquí no se corta se paga
 * multiplicado. Es la última red de seguridad, por si una operación devuelve
 * más de lo previsto (hallazgos con `fullContent` largo, listados grandes…).
 */
export const TOOL_RESULT_MAX_CHARS = 32_000;

function capToolResult(payload: unknown): string {
  const raw = JSON.stringify(payload);
  if (raw.length <= TOOL_RESULT_MAX_CHARS) return raw;
  // Se devuelve como texto, no como JSON troceado: un JSON cortado a la mitad
  // confunde más al modelo que un aviso explícito de recorte.
  return JSON.stringify({
    truncated: true,
    chars: raw.length,
    aviso:
      "Resultado demasiado grande, recortado. Afina la consulta (menos elementos) o pide el detalle de uno solo.",
    datos: raw.slice(0, TOOL_RESULT_MAX_CHARS - 500),
  });
}

/** Ejecuta una herramienta y devuelve su resultado serializado (para el modelo). */
export async function executeAgentTool(
  userId: string,
  name: string,
  rawArgs: string,
): Promise<string> {
  const args = parseArgs(rawArgs);
  try {
    return capToolResult(await runAgentTool(userId, name, args));
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message.slice(0, 200) : "Error ejecutando la herramienta",
    });
  }
}

async function runAgentTool(
  userId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "listar_ideas":
      return listIdeasOp({ status: args.status as string, limit: args.limit as number });
    case "listar_hallazgos":
      return listFindingsOp({ status: args.status as string, limit: args.limit as number });
    case "listar_creaciones":
      // includeBody:false — el listado nunca lleva cuerpos completos al historial.
      return listAssetsOp({ limit: args.limit as number, includeBody: false });
    case "ver_creacion":
      return getAssetOp({
        id: String(args.id ?? ""),
        maxChars: typeof args.maxChars === "number" ? args.maxChars : undefined,
      });
    case "listar_canales":
      return listChannelsOp();
    case "ver_marca":
      return getBrandOp();
    case "crear_idea":
      return createIdeaOp(userId, {
        title: String(args.title ?? "").slice(0, 300),
        angle: (args.angle as string) ?? null,
        rationale: (args.rationale as string) ?? null,
        approved: args.approved as boolean | undefined,
      });
    case "crear_hallazgo":
      return createFindingOp({
        title: String(args.title ?? "").slice(0, 300),
        url: (args.url as string) ?? null,
        snippet: (args.snippet as string) ?? null,
        summary: (args.summary as string) ?? null,
      });
    case "crear_creacion":
      return createCreationOp(userId, {
        title: String(args.title ?? "").slice(0, 300),
        body: String(args.body ?? ""),
        channelType: (args.channelType as string) ?? null,
      });
    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}
