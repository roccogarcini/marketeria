import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { runSourceFetch } from "@/lib/research/fetcher";
import { isUniqueViolation } from "@/lib/research/findings";
import { isValidCron, removeSchedule, syncAutomationSchedule } from "@/lib/automations/scheduler";
import { humanizeCron } from "@/lib/automations/schedule";
import { runAutomation } from "@/lib/automations/runner";
import { canTransitionIdeaStatus, type IdeaStatus } from "@/lib/ideas/status";
import { LLM_PROVIDER_TYPES, type AgentPatch } from "@/lib/agents/schema";
import type { ChannelPatch } from "@/lib/channels/schema";
import type { BrandUpdate } from "@/lib/brand/schema";

/**
 * Operaciones de la API externa, compartidas por los endpoints REST
 * (/api/v1/**) y las herramientas del servidor MCP (/api/mcp). Aquí no hay
 * autenticación: los callers ya han validado la API key y pasan su userId.
 */

const EXTERNAL_SOURCE_NAME = "API externa";

/** Fuente contenedora de los hallazgos insertados desde fuera (get-or-create). */
async function externalSource(): Promise<{ id: string }> {
  const existing = await prisma.source.findFirst({
    where: { name: EXTERNAL_SOURCE_NAME, type: "MANUAL" },
    select: { id: true },
  });
  if (existing) return existing;
  return prisma.source.create({
    data: { name: EXTERNAL_SOURCE_NAME, type: "MANUAL", isActive: true },
    select: { id: true },
  });
}

// ── Investigación ──────────────────────────────────────────────────────────

/**
 * Clave estable de la Source de una investigación lanzada desde fuera: el
 * mismo brief usa SIEMPRE la misma fuente. Con una Source nueva por llamada,
 * el dedupe de hallazgos (que filtra por sourceId) nunca encontraría
 * duplicados: cada repetición reinsertaría los mismos hallazgos y dejaría una
 * fila huérfana en Source.
 *
 * El prefijo acota la reutilización a las fuentes creadas por esta vía: las
 * del panel y las de las automatizaciones tienen externalKey null y no se ven
 * afectadas (su configJson no se toca desde aquí).
 */
function researchSourceKey(brief: string): string {
  const digest = createHash("sha256").update(brief.trim()).digest("hex");
  return `api-research:${digest}`;
}

/**
 * Hallazgos devueltos por investigación. Al reutilizar la fuente, la tabla
 * acumula los de todas las repeticiones del mismo brief; devolvemos los más
 * recientes con un tope para no crecer sin límite en la respuesta.
 */
const RESEARCH_FINDINGS_LIMIT = 50;

export async function runResearchOp(
  userId: string,
  brief: string,
  maxItems?: number,
  /** Antigüedad máxima de los hallazgos en meses (default 6; el filtro no aplica si el brief pide histórico). */
  maxAgeMonths?: number,
) {
  const name = `Investigación IA · ${brief.slice(0, 40)}`;
  const configJson = JSON.stringify({
    brief,
    ...(maxItems ? { maxItems } : {}),
    ...(maxAgeMonths ? { maxAgeMonths } : {}),
  });
  const externalKey = researchSourceKey(brief);
  const upsertSource = () =>
    prisma.source.upsert({
      where: { externalKey },
      create: { externalKey, name, type: "AI_RESEARCH", configJson, isActive: true },
      // Los parámetros del último lanzamiento mandan (maxItems/maxAgeMonths
      // pueden cambiar entre llamadas con el mismo brief).
      update: { name, configJson, isActive: true },
      select: { id: true },
    });
  let source: { id: string };
  try {
    source = await upsertSource();
  } catch (err) {
    // Dos investigaciones idénticas a la vez: la que pierde la carrera ve el
    // choque de externalKey y reintenta, que ya encuentra la fuente creada.
    if (!isUniqueViolation(err)) throw err;
    source = await upsertSource();
  }
  const outcome = await runSourceFetch(source.id, { userId });
  const findings = await prisma.finding.findMany({
    where: { sourceId: source.id },
    orderBy: { fetchedAt: "desc" },
    take: RESEARCH_FINDINGS_LIMIT,
    select: {
      id: true,
      title: true,
      url: true,
      snippet: true,
      summary: true,
      publishedAt: true,
    },
  });
  return {
    sourceId: source.id,
    created: outcome.created,
    skipped: outcome.skipped,
    error: outcome.error,
    provider: outcome.researchProvider ?? null,
    via: outcome.researchVia ?? null,
    findings,
  };
}

// ── Hallazgos ──────────────────────────────────────────────────────────────

export async function listFindingsOp(params: {
  status?: string;
  limit?: number;
}) {
  return prisma.finding.findMany({
    where: params.status ? { status: params.status } : undefined,
    orderBy: { fetchedAt: "desc" },
    take: Math.max(1, Math.min(100, params.limit ?? 25)),
    select: {
      id: true,
      title: true,
      url: true,
      snippet: true,
      summary: true,
      status: true,
      publishedAt: true,
      fetchedAt: true,
      source: { select: { id: true, name: true, type: true } },
    },
  });
}

/**
 * Inserta un hallazgo en la fuente "API externa". Con el índice único
 * (sourceId, url) de Finding, repetir la misma URL no crea un duplicado:
 * se devuelve el hallazgo que ya existía (operación idempotente).
 */
export async function createFindingOp(input: {
  title: string;
  url?: string | null;
  snippet?: string | null;
  summary?: string | null;
  author?: string | null;
  publishedAt?: Date | null;
}) {
  const source = await externalSource();
  const select = { id: true, title: true, status: true };
  try {
    return await prisma.finding.create({
      data: {
        sourceId: source.id,
        title: input.title.slice(0, 300),
        url: input.url ?? null,
        snippet: input.snippet ?? null,
        summary: input.summary ?? null,
        author: input.author ?? null,
        publishedAt: input.publishedAt ?? null,
        status: "NEW",
      },
      select,
    });
  } catch (err) {
    if (!isUniqueViolation(err) || !input.url) throw err;
    const existing = await prisma.finding.findFirst({
      where: { sourceId: source.id, url: input.url },
      select,
    });
    if (!existing) throw err;
    return existing;
  }
}

// ── Ideas ──────────────────────────────────────────────────────────────────

export async function listIdeasOp(params: { status?: string; limit?: number }) {
  return prisma.idea.findMany({
    where: params.status ? { status: params.status } : undefined,
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(100, params.limit ?? 25)),
    select: {
      id: true,
      title: true,
      angle: true,
      rationale: true,
      status: true,
      referenceUrl: true,
      updatedAt: true,
    },
  });
}

export async function createIdeaOp(
  userId: string,
  input: {
    title: string;
    angle?: string | null;
    rationale?: string | null;
    referenceUrl?: string | null;
    /** true (default): entra APPROVED lista para producir; false: PROPOSED. */
    approved?: boolean;
  },
) {
  const approved = input.approved ?? true;
  return prisma.idea.create({
    data: {
      title: input.title.slice(0, 300),
      angle: input.angle ?? null,
      rationale: input.rationale ?? null,
      referenceUrl: input.referenceUrl ?? null,
      status: approved ? "APPROVED" : "PROPOSED",
      createdById: userId,
      ...(approved ? { decidedById: userId, decidedAt: new Date() } : {}),
    },
    select: { id: true, title: true, status: true },
  });
}

/**
 * Actualiza una idea (campos y/o estado). Las transiciones de estado siguen
 * la misma máquina que el endpoint interno /api/ideas/[id]/status; si el
 * estado pedido es el actual, se trata como no-op (no falla).
 */
export async function updateIdeaOp(
  userId: string,
  ideaId: string,
  input: {
    title?: string;
    angle?: string | null;
    rationale?: string | null;
    referenceUrl?: string | null;
    status?: IdeaStatus;
  },
): Promise<
  | {
      ok: true;
      idea: {
        id: string;
        title: string;
        angle: string | null;
        rationale: string | null;
        status: string;
        referenceUrl: string | null;
        updatedAt: Date;
      };
    }
  | { ok: false; error: string }
> {
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    select: { id: true, status: true },
  });
  if (!idea) return { ok: false, error: "Idea no encontrada" };

  // Misma validación que el PATCH interno: si viene referenceUrl no vacío,
  // exigir URL válida.
  if (input.referenceUrl) {
    try {
      new URL(input.referenceUrl);
    } catch {
      return { ok: false, error: "referenceUrl no es una URL válida" };
    }
  }

  const data: {
    title?: string;
    angle?: string | null;
    rationale?: string | null;
    referenceUrl?: string | null;
    status?: string;
    decidedById?: string;
    decidedAt?: Date;
  } = {};
  if (input.title !== undefined) data.title = input.title.slice(0, 300);
  if (input.angle !== undefined) data.angle = input.angle;
  if (input.rationale !== undefined) data.rationale = input.rationale;
  if (input.referenceUrl !== undefined) data.referenceUrl = input.referenceUrl;

  if (input.status !== undefined && input.status !== idea.status) {
    if (!canTransitionIdeaStatus(idea.status, input.status)) {
      return {
        ok: false,
        error: `Transición no permitida: ${idea.status} → ${input.status}`,
      };
    }
    data.status = input.status;
    if (input.status === "APPROVED" || input.status === "REJECTED") {
      data.decidedById = userId;
      data.decidedAt = new Date();
    }
  }

  const updated = await prisma.idea.update({
    where: { id: ideaId },
    data,
    select: {
      id: true,
      title: true,
      angle: true,
      rationale: true,
      status: true,
      referenceUrl: true,
      updatedAt: true,
    },
  });
  return { ok: true, idea: updated };
}

/**
 * Borra una idea y, en cascada vía Prisma, sus comentarios y contenidos
 * (→ versiones y assets). Registra la actividad con el userId del dueño de
 * la API key, igual que hace el DELETE interno con el usuario de sesión.
 */
export async function deleteIdeaOp(
  userId: string,
  ideaId: string,
): Promise<
  | { ok: true; deletedId: string; cascadedContents: number; cascadedComments: number }
  | { ok: false; error: string }
> {
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    select: {
      id: true,
      title: true,
      _count: { select: { contents: true, comments: true } },
    },
  });
  if (!idea) return { ok: false, error: "Idea no encontrada" };

  await prisma.idea.delete({ where: { id: ideaId } });

  await prisma.activity.create({
    data: {
      userId,
      entityType: "idea",
      entityId: ideaId,
      action: "delete",
      metaJson: JSON.stringify({
        title: idea.title,
        cascadedContents: idea._count.contents,
        cascadedComments: idea._count.comments,
      }),
    },
  });

  return {
    ok: true,
    deletedId: ideaId,
    cascadedContents: idea._count.contents,
    cascadedComments: idea._count.comments,
  };
}

// ── Creaciones (insertar piezas ya hechas fuera) ───────────────────────────

export async function createCreationOp(
  userId: string,
  input: {
    title: string;
    body: string;
    /** Canal destino por id o por tipo/nombre (opcional). */
    channelId?: string | null;
    channelType?: string | null;
    status?: "READY" | "PUBLISHED";
  },
): Promise<
  | { ok: true; ideaId: string; contentId: string; assetId: string | null }
  | { ok: false; error: string }
> {
  // Resolver canal si se indicó (por id, o el primero activo de ese tipo/nombre).
  let channel: { id: string } | null = null;
  if (input.channelId) {
    channel = await prisma.channel.findUnique({
      where: { id: input.channelId },
      select: { id: true },
    });
    if (!channel) return { ok: false, error: "channelId no encontrado" };
  } else if (input.channelType) {
    channel = await prisma.channel.findFirst({
      where: {
        isActive: true,
        OR: [
          { type: input.channelType.toUpperCase() },
          { name: { equals: input.channelType, mode: "insensitive" } },
        ],
      },
      orderBy: { sortOrder: "asc" },
      select: { id: true },
    });
    if (!channel) {
      return { ok: false, error: `No hay canal activo de tipo/nombre "${input.channelType}"` };
    }
  }

  const title = input.title.slice(0, 300);
  const result = await prisma.$transaction(async (tx) => {
    // Idea + Content trazan la pieza en el pipeline aunque venga hecha de fuera.
    const idea = await tx.idea.create({
      data: {
        title,
        rationale: "Creación insertada desde la API externa.",
        status: "APPROVED",
        createdById: userId,
        decidedById: userId,
        decidedAt: new Date(),
      },
      select: { id: true },
    });
    const content = await tx.content.create({
      data: {
        ideaId: idea.id,
        title,
        body: input.body,
        status: "APPROVED",
        currentVersion: 1,
        createdById: userId,
        versions: {
          create: [
            {
              version: 1,
              body: input.body,
              notes: "Insertada vía API externa.",
              isMilestone: true,
              createdById: userId,
            },
          ],
        },
      },
      select: { id: true },
    });
    let assetId: string | null = null;
    if (channel) {
      const asset = await tx.asset.create({
        data: {
          contentId: content.id,
          channelId: channel.id,
          body: input.body,
          status: input.status ?? "READY",
          aiExecutionMode: "API",
        },
        select: { id: true },
      });
      assetId = asset.id;
    }
    return { ideaId: idea.id, contentId: content.id, assetId };
  });

  return { ok: true, ...result };
}

// ── Creaciones / canales (lectura) ─────────────────────────────────────────

/** Extracto que acompaña a cada creación en el listado sin cuerpo. */
const ASSET_PREVIEW_CHARS = 300;
/** Tope del cuerpo que devuelve `getAssetOp` (aprox. 5k tokens). */
export const ASSET_BODY_MAX_CHARS = 20_000;

export async function listAssetsOp(params: {
  channelId?: string;
  status?: string;
  limit?: number;
  /**
   * `false` sustituye el cuerpo por tamaño + extracto. Lo usa el chat agéntico:
   * su resultado entra en el historial y se REENVÍA en cada iteración del bucle
   * de tools, así que 30 carruseles de HTML costaban millones de tokens por
   * pregunta. La API v1 y el MCP siguen recibiendo el cuerpo entero (default).
   */
  includeBody?: boolean;
}) {
  const rows = await prisma.asset.findMany({
    where: {
      ...(params.channelId ? { channelId: params.channelId } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: Math.max(1, Math.min(50, params.limit ?? 20)),
    select: {
      id: true,
      body: true,
      status: true,
      updatedAt: true,
      channel: { select: { id: true, name: true, type: true } },
      content: { select: { id: true, title: true } },
    },
  });
  if (params.includeBody === false) {
    // El cuerpo se lee de la BD (Prisma no sabe medir longitudes sin SQL crudo)
    // pero NO sale de este proceso: se resume aquí mismo.
    return rows.map(({ body, ...rest }) => ({
      ...rest,
      bodyChars: body?.length ?? 0,
      bodyPreview: (body ?? "").slice(0, ASSET_PREVIEW_CHARS),
    }));
  }
  return rows;
}

/**
 * Una creación concreta con su cuerpo, recortado a `maxChars`. Es la pareja de
 * `listAssetsOp({ includeBody: false })`: primero se lista barato, luego se
 * pide el cuerpo de la que interesa.
 */
export async function getAssetOp(params: { id: string; maxChars?: number }) {
  const asset = await prisma.asset.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      body: true,
      status: true,
      updatedAt: true,
      channel: { select: { id: true, name: true, type: true } },
      content: { select: { id: true, title: true } },
    },
  });
  if (!asset) return { error: `No existe la creación ${params.id}` };
  const max = Math.max(500, Math.min(ASSET_BODY_MAX_CHARS, params.maxChars ?? ASSET_BODY_MAX_CHARS));
  const full = asset.body ?? "";
  return {
    ...asset,
    body: full.slice(0, max),
    bodyChars: full.length,
    truncated: full.length > max,
  };
}

export async function listChannelsOp() {
  return prisma.channel.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, type: true },
  });
}

// ── Agentes ────────────────────────────────────────────────────────────────

/** Campos que realmente vienen en un patch (para la auditoría de actividad). */
function patchedFields(input: Record<string, unknown>): string[] {
  return Object.keys(input).filter((k) => input[k] !== undefined);
}

/** Registro de actividad de las mutaciones (mismo patrón que deleteIdeaOp). */
async function logActivity(
  userId: string,
  entityType: string,
  entityId: string,
  action: string,
  meta: Record<string, unknown>,
) {
  await prisma.activity.create({
    data: { userId, entityType, entityId, action, metaJson: JSON.stringify(meta) },
  });
}

const AGENT_SELECT = {
  id: true,
  slug: true,
  name: true,
  role: true,
  systemPrompt: true,
  temperature: true,
  maxTokens: true,
  icon: true,
  isActive: true,
  providerId: true,
  modelId: true,
  updatedAt: true,
} as const;

/** Lista los agentes de chat con su systemPrompt (mismo orden que el panel). */
export async function listAgentsOp() {
  return prisma.agent.findMany({
    orderBy: { createdAt: "desc" },
    select: AGENT_SELECT,
  });
}

/**
 * Actualiza un agente de chat (systemPrompt, nombre y el resto de campos que
 * edita el panel). Misma validación de proveedor que el PATCH de sesión
 * (/api/agents/[id]): si se asigna providerId debe existir, ser del usuario
 * y ser un LLM; providerId null limpia el modelId.
 */
export async function updateAgentOp(
  userId: string,
  agentId: string,
  input: AgentPatch,
): Promise<
  | { ok: true; agent: { id: string; slug: string; name: string; systemPrompt: string } }
  | { ok: false; error: string }
> {
  const existing = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, name: true },
  });
  if (!existing) return { ok: false, error: "Agente no encontrado" };

  const fields = patchedFields(input);
  if (fields.length === 0) return { ok: false, error: "No se envió ningún campo para actualizar" };

  const data = { ...input };
  if (data.providerId) {
    const provider = await prisma.lLMProvider.findFirst({
      where: { id: data.providerId, userId },
      select: { providerType: true },
    });
    if (!provider || !LLM_PROVIDER_TYPES.includes(provider.providerType)) {
      return { ok: false, error: "Proveedor no válido (no existe, no es tuyo o no es un LLM)." };
    }
  } else if (data.providerId === null) {
    data.modelId = null;
  }

  const agent = await prisma.agent.update({
    where: { id: agentId },
    data,
    select: AGENT_SELECT,
  });
  await logActivity(userId, "agent", agentId, "update", { name: agent.name, fields });
  return { ok: true, agent };
}

// ── Canales (edición) ──────────────────────────────────────────────────────

/**
 * Actualiza un canal (systemPrompt, templateMarkdown, constraintsJson y el
 * resto de campos del panel). Misma validación que el PATCH de sesión
 * (/api/channels/[id]): si se asigna agentId, el agente debe existir.
 */
export async function updateChannelOp(
  userId: string,
  channelId: string,
  input: ChannelPatch,
): Promise<
  | { ok: true; channel: { id: string; name: string; type: string } }
  | { ok: false; error: string }
> {
  const existing = await prisma.channel.findUnique({
    where: { id: channelId },
    select: { id: true, name: true },
  });
  if (!existing) return { ok: false, error: "Canal no encontrado" };

  const fields = patchedFields(input);
  if (fields.length === 0) return { ok: false, error: "No se envió ningún campo para actualizar" };

  if (input.agentId) {
    const agent = await prisma.agent.findUnique({
      where: { id: input.agentId },
      select: { id: true },
    });
    if (!agent) return { ok: false, error: "Agente no encontrado" };
  }

  const channel = await prisma.channel.update({ where: { id: channelId }, data: input });
  await logActivity(userId, "channel", channelId, "update", { name: channel.name, fields });
  return { ok: true, channel };
}

// ── Automatizaciones ───────────────────────────────────────────────────────

export async function listAutomationsOp(params: { limit?: number }) {
  const automations = await prisma.automation.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(100, params.limit ?? 50)),
    include: {
      _count: { select: { runs: true } },
      runs: {
        orderBy: { startedAt: "desc" },
        take: 1,
        select: { status: true, startedAt: true, finishedAt: true, logsText: true },
      },
    },
  });
  return automations.map((a) => {
    const last = a.runs[0] ?? null;
    return {
      id: a.id,
      name: a.name,
      triggerType: a.triggerType,
      cron: a.cron,
      schedule: humanizeCron(a.cron),
      isActive: a.isActive,
      lastRunAt: a.lastRunAt,
      totalRuns: a._count.runs,
      lastRun: last
        ? { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, logs: last.logsText }
        : null,
    };
  });
}

/**
 * Crea una automatización de investigación IA (AI_RESEARCH) y la programa.
 * Reproduce lo que hace el panel: crea la Source enlazada y la Automation que
 * la apunta vía paramsJson.sourceId, y registra el cron. Si se pasa `cron`
 * queda SCHEDULED; si no, MANUAL (se lanza a mano con run_automation).
 */
export async function createAutomationOp(
  userId: string,
  input: {
    name: string;
    brief: string;
    cron?: string | null;
    maxItems?: number;
    maxAgeMonths?: number;
  },
): Promise<
  | { ok: true; id: string; name: string; triggerType: string; cron: string | null; schedule: string; sourceId: string }
  | { ok: false; error: string }
> {
  const cron = input.cron?.trim() || null;
  if (cron && !isValidCron(cron)) {
    return { ok: false, error: `Expresión cron inválida: "${cron}"` };
  }

  const source = await prisma.source.create({
    data: {
      name: `Investigación IA · ${input.brief.slice(0, 40)}`,
      type: "AI_RESEARCH",
      configJson: JSON.stringify({
        brief: input.brief,
        ...(input.maxItems ? { maxItems: input.maxItems } : {}),
        ...(input.maxAgeMonths ? { maxAgeMonths: input.maxAgeMonths } : {}),
      }),
      isActive: true,
    },
    select: { id: true },
  });

  const automation = await prisma.automation.create({
    data: {
      name: input.name.slice(0, 200),
      triggerType: cron ? "SCHEDULED" : "MANUAL",
      cron,
      targetType: "SOURCE",
      paramsJson: JSON.stringify({ sourceId: source.id }),
      isActive: true,
      createdById: userId,
    },
    select: { id: true, name: true, triggerType: true, cron: true },
  });

  await syncAutomationSchedule(automation.id);

  return {
    ok: true,
    id: automation.id,
    name: automation.name,
    triggerType: automation.triggerType,
    cron: automation.cron,
    schedule: humanizeCron(automation.cron),
    sourceId: source.id,
  };
}

/**
 * Actualiza una automatización. `cron` se valida igual que el PATCH interno
 * (/api/automations/[id]); cron vacío o null la deja MANUAL. brief/maxItems/
 * maxAgeMonths viven en la Source AI_RESEARCH enlazada (paramsJson.sourceId),
 * igual que al crearla desde create_automation o el panel.
 */
export async function updateAutomationOp(
  automationId: string,
  input: {
    name?: string;
    brief?: string;
    cron?: string | null;
    maxItems?: number;
    maxAgeMonths?: number;
    isActive?: boolean;
  },
): Promise<
  | { ok: true; id: string; name: string; triggerType: string; cron: string | null; schedule: string; isActive: boolean }
  | { ok: false; error: string }
> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true, paramsJson: true },
  });
  if (!automation) return { ok: false, error: "Automatización no encontrada" };

  const data: {
    name?: string;
    cron?: string | null;
    triggerType?: string;
    isActive?: boolean;
  } = {};
  if (input.name !== undefined) data.name = input.name.slice(0, 200);
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.cron !== undefined) {
    const cron = input.cron?.trim() || null;
    if (cron && !isValidCron(cron)) {
      return { ok: false, error: `Expresión cron inválida: "${cron}"` };
    }
    data.cron = cron;
    data.triggerType = cron ? "SCHEDULED" : "MANUAL";
  }

  // brief/maxItems/maxAgeMonths → configJson de la Source de investigación.
  if (
    input.brief !== undefined ||
    input.maxItems !== undefined ||
    input.maxAgeMonths !== undefined
  ) {
    let sourceId: string | null = null;
    try {
      const params = JSON.parse(automation.paramsJson ?? "{}") as { sourceId?: string };
      sourceId = params.sourceId ?? null;
    } catch {
      sourceId = null;
    }
    const source = sourceId
      ? await prisma.source.findUnique({
          where: { id: sourceId },
          select: { id: true, configJson: true },
        })
      : null;
    if (!source) {
      return {
        ok: false,
        error:
          "Esta automatización no tiene fuente de investigación asociada; brief/maxItems/maxAgeMonths no aplican.",
      };
    }
    let cfg: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(source.configJson ?? "{}");
      if (parsed && typeof parsed === "object") cfg = parsed as Record<string, unknown>;
    } catch (err) {
      // Aquí SÍ seguimos: este es el camino de reparación (el operador está
      // reescribiendo la configuración). Pero se deja constancia, porque el
      // resto de claves del configJson roto se pierden en el update.
      console.warn(
        `[operations] configJson inválido en la fuente ${source.id}; se reescribe desde cero:`,
        err instanceof Error ? err.message : err,
      );
      cfg = {};
    }
    if (input.brief !== undefined) cfg.brief = input.brief;
    if (input.maxItems !== undefined) cfg.maxItems = input.maxItems;
    if (input.maxAgeMonths !== undefined) cfg.maxAgeMonths = input.maxAgeMonths;
    await prisma.source.update({
      where: { id: source.id },
      data: {
        configJson: JSON.stringify(cfg),
        ...(input.brief !== undefined
          ? { name: `Investigación IA · ${input.brief.slice(0, 40)}` }
          : {}),
      },
    });
  }

  const updated = await prisma.automation.update({
    where: { id: automationId },
    data,
    select: { id: true, name: true, triggerType: true, cron: true, isActive: true },
  });
  await syncAutomationSchedule(automationId);

  return {
    ok: true,
    id: updated.id,
    name: updated.name,
    triggerType: updated.triggerType,
    cron: updated.cron,
    schedule: humanizeCron(updated.cron),
    isActive: updated.isActive,
  };
}

/** Activa o pausa una automatización (re-sincroniza su cron). */
export async function toggleAutomationOp(automationId: string, isActive: boolean) {
  return updateAutomationOp(automationId, { isActive });
}

/** Borra una automatización (y sus runs en cascada) y desprograma su cron. */
export async function deleteAutomationOp(
  automationId: string,
): Promise<
  | { ok: true; deletedId: string; name: string }
  | { ok: false; error: string }
> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true, name: true },
  });
  if (!automation) return { ok: false, error: "Automatización no encontrada" };
  await prisma.automation.delete({ where: { id: automationId } });
  removeSchedule(automationId);
  return { ok: true, deletedId: automationId, name: automation.name };
}

/**
 * Historial de ejecuciones de una automatización (las últimas N, log recortado
 * a 2000 caracteres para depurar sin arrastrar textos enormes).
 */
export async function listAutomationRunsOp(
  automationId: string,
  limit?: number,
): Promise<
  | {
      ok: true;
      runs: {
        id: string;
        status: string;
        startedAt: string;
        finishedAt: string | null;
        logs: string | null;
      }[];
    }
  | { ok: false; error: string }
> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true },
  });
  if (!automation) return { ok: false, error: "Automatización no encontrada" };

  const runs = await prisma.automationRun.findMany({
    where: { automationId },
    orderBy: { startedAt: "desc" },
    take: Math.max(1, Math.min(100, limit ?? 30)),
    select: {
      id: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      logsText: true,
    },
  });

  return {
    ok: true,
    runs: runs.map((r) => ({
      id: r.id,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      logs: r.logsText ? r.logsText.slice(0, 2000) : null,
    })),
  };
}

/** Lanza una automatización a mano y devuelve el resultado con su log. */
export async function runAutomationOp(userId: string, automationId: string) {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true },
  });
  if (!automation) return { ok: false as const, error: "Automatización no encontrada" };
  const result = await runAutomation(automationId, { userId });
  return { ok: true as const, ...result };
}

/**
 * Resumen del pipeline — las mismas cifras que muestra el dashboard del panel:
 * hallazgos, fuentes, ideas por revisar (DRAFT/PROPOSED), ideas aprobadas y
 * creaciones; más el estado de las automatizaciones y canales activos.
 */
export async function getDashboardSummaryOp() {
  const [
    findingsCount,
    sourcesCount,
    suggestedCount,
    approvedIdeasCount,
    assetsCount,
    ideasByStatus,
    automationsTotal,
    automationsActive,
    activeChannels,
  ] = await Promise.all([
    prisma.finding.count(),
    prisma.source.count(),
    prisma.idea.count({ where: { status: { in: ["DRAFT", "PROPOSED"] } } }),
    prisma.idea.count({ where: { status: "APPROVED" } }),
    prisma.asset.count(),
    prisma.idea.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.automation.count(),
    prisma.automation.count({ where: { isActive: true } }),
    prisma.channel.count({ where: { isActive: true } }),
  ]);

  return {
    totals: {
      findings: findingsCount,
      sources: sourcesCount,
      suggested: suggestedCount,
      approvedIdeas: approvedIdeasCount,
      assets: assetsCount,
    },
    ideasByStatus: Object.fromEntries(
      ideasByStatus.map((g) => [g.status, g._count._all]),
    ),
    automations: { total: automationsTotal, active: automationsActive },
    activeChannels,
  };
}

export async function getBrandOp() {
  const brand = await prisma.brandProfile.findUnique({ where: { id: "default" } });
  if (!brand) return { configured: false };
  return {
    configured: true,
    name: brand.name,
    tone: brand.tone,
    voice: brand.voice,
    audience: brand.audience,
    editorialLines: brand.editorialLinesJson ? JSON.parse(brand.editorialLinesJson) : [],
    mustAvoid: brand.mustAvoid,
    visualIdentity: brand.visualIdentity,
  };
}

/**
 * Actualiza el perfil de marca (singleton 'default') desde la API externa o
 * el MCP. A diferencia del PUT de sesión del panel (reemplazo completo), aquí
 * la actualización es PARCIAL: solo cambian los campos enviados; null limpia
 * un campo. Si la marca aún no existe, hace falta al menos `name` para crearla.
 * Mismas reglas de validación por campo que el panel (brandUpdateSchema).
 */
export async function updateBrandOp(
  userId: string,
  input: BrandUpdate,
): Promise<
  | { ok: true; brand: Awaited<ReturnType<typeof getBrandOp>> }
  | { ok: false; error: string }
> {
  const existing = await prisma.brandProfile.findUnique({
    where: { id: "default" },
    select: { id: true },
  });
  if (!existing && input.name === undefined) {
    return {
      ok: false,
      error: "La marca aún no está configurada: incluye al menos `name` para crearla.",
    };
  }

  const fields = patchedFields(input);
  if (fields.length === 0) return { ok: false, error: "No se envió ningún campo para actualizar" };

  const data: {
    name?: string;
    tone?: string | null;
    voice?: string | null;
    audience?: string | null;
    editorialLinesJson?: string | null;
    mustAvoid?: string | null;
    visualIdentity?: string | null;
    logoDataUri?: string | null;
  } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.tone !== undefined) data.tone = input.tone;
  if (input.voice !== undefined) data.voice = input.voice;
  if (input.audience !== undefined) data.audience = input.audience;
  if (input.editorialLines !== undefined) {
    data.editorialLinesJson = JSON.stringify(input.editorialLines);
  }
  if (input.mustAvoid !== undefined) data.mustAvoid = input.mustAvoid;
  if (input.visualIdentity !== undefined) data.visualIdentity = input.visualIdentity;
  if (input.logoDataUri !== undefined) data.logoDataUri = input.logoDataUri;

  if (existing) {
    await prisma.brandProfile.update({ where: { id: "default" }, data });
  } else {
    await prisma.brandProfile.create({ data: { id: "default", ...data, name: input.name! } });
  }
  await logActivity(userId, "brand", "default", "update", { fields });
  return { ok: true, brand: await getBrandOp() };
}
