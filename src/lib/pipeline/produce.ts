import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";
import { bestMaterial } from "@/lib/research/material";
import { buildAssetPrompts, GROUNDING_RULES } from "@/lib/channels/asset-prompt";
import { resolveAgentModel } from "@/lib/ai/agent-model";
import { getBrandContext, applyBrandLogo } from "@/lib/brand/prompt";
import { writeCarouselFiles } from "@/lib/carousel/files";
import {
  carouselOutputProblem,
  carouselRetryInstruction,
} from "@/lib/carousel/validate";

/**
 * Lógica de producción "idea → contenido → creaciones por canal", extraída
 * del route handler para reutilizarla desde:
 *   - POST /api/produce (UI)
 *   - POST /api/v1/produce (API externa)
 *   - la herramienta produce_content del servidor MCP
 */

export type ChannelResult = {
  channelId: string;
  asset?: { id: string; status: string };
  existing?: { id: string; status: string };
  error?: string;
};

export type ProduceResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      content: { id: string; title: string };
      contentGenerated: boolean;
      results: ChannelResult[];
    };

/**
 * Recupera el material fuente de la idea: los hallazgos que la originaron
 * (idea → insight → analysisRun → findingIds), priorizando fullContent.
 * Devuelve un bloque de texto acotado o null si no hay traza.
 */
async function sourceMaterialForIdea(ideaId: string): Promise<string | null> {
  const idea = await prisma.idea.findUnique({
    where: { id: ideaId },
    select: { insight: { select: { analysisRun: { select: { findingIdsJson: true } } } } },
  });
  const raw = idea?.insight?.analysisRun?.findingIdsJson;
  if (!raw) return null;
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return null;
  }
  if (ids.length === 0) return null;
  const findings = await prisma.finding.findMany({
    where: { id: { in: ids.slice(0, 5) } },
    select: { title: true, url: true, fullContent: true, summary: true, snippet: true },
  });
  const blocks: string[] = [];
  let budget = 12_000; // chars totales de material en el prompt
  for (const f of findings) {
    const text = bestMaterial(f);
    if (!text || budget <= 0) continue;
    const chunk = text.slice(0, Math.min(text.length, budget));
    budget -= chunk.length;
    blocks.push(`### ${f.title}${f.url ? `\n(${f.url})` : ""}\n${chunk}`);
  }
  return blocks.length > 0 ? blocks.join("\n\n---\n\n") : null;
}

/**
 * Produce el contenido base de una idea APPROVED y, opcionalmente, sus
 * creaciones para N canales (saltando las ya existentes).
 */
export async function produceIdea(
  userId: string,
  params: { ideaId: string; channelIds?: string[] },
): Promise<ProduceResult> {
  const idea = await prisma.idea.findUnique({ where: { id: params.ideaId } });
  if (!idea) return { ok: false, status: 404, error: "Idea no encontrada" };
  if (idea.status !== "APPROVED") {
    return { ok: false, status: 409, error: "La idea debe estar APPROVED" };
  }

  const channelIds = params.channelIds ?? [];

  // ── Paso 1: resolver Content APPROVED ────────────────────────────────
  let content = await prisma.content.findFirst({
    where: { ideaId: idea.id, status: "APPROVED" },
    orderBy: { updatedAt: "desc" },
  });

  let contentGenerated = false;

  // Perfil de marca (voz + identidad visual + logo): se aplica tanto al texto
  // base como a la adaptación/diseño por canal.
  const brand = await getBrandContext();

  if (!content) {
    const systemPrompt = [
      "Eres un redactor editorial senior. Produces contenido markdown listo para editar.",
      brand.textBlock,
      GROUNDING_RULES,
    ]
      .filter(Boolean)
      .join("\n\n");
    // Material fuente real (hallazgos enriquecidos que originaron la idea):
    // es lo que evita que el redactor rellene con generalidades inventadas.
    const material = await sourceMaterialForIdea(idea.id);
    const userPrompt = [
      `# ${idea.title}`,
      idea.angle && `Ángulo: ${idea.angle}`,
      idea.rationale && `Rationale: ${idea.rationale}`,
      idea.referenceUrl && `URL de referencia: ${idea.referenceUrl}`,
      material &&
        `\nMaterial fuente (única fuente de verdad para datos y afirmaciones):\n${material}`,
      !material &&
        "\nATENCIÓN: no hay material fuente completo. Limítate a lo que dicen el título, el ángulo y el rationale; marca los huecos con [FALTA: …] y no inventes datos.",
      "",
      "Escribe el contenido completo en Markdown. Empieza con un H1.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = await execute(userId, {
      phase: "PRODUCTION",
      refType: "idea",
      refId: idea.id,
      systemPrompt,
      userPrompt,
    });
    if (result.status === "ERROR") {
      return { ok: false, status: 500, error: result.error ?? "Error IA" };
    }
    const body = result.output.trim();
    const heading = body.match(/^#\s+(.+)$/m);
    const title = heading ? heading[1].slice(0, 300) : idea.title;

    content = await prisma.content.create({
      data: {
        ideaId: idea.id,
        title,
        body,
        status: "APPROVED",
        currentVersion: 1,
        createdById: userId,
        versions: {
          create: [
            {
              version: 1,
              body,
              notes: "Versión inicial (atajo idea → soporte).",
              isMilestone: true,
              createdById: userId,
            },
          ],
        },
      },
    });
    contentGenerated = true;
  }

  // ── Paso 2: sin canales, ya está. ────────────────────────────────────
  if (channelIds.length === 0) {
    return {
      ok: true,
      content: { id: content.id, title: content.title },
      contentGenerated,
      results: [],
    };
  }

  // ── Paso 3: generar N assets ─────────────────────────────────────────
  const results: ChannelResult[] = [];

  for (const channelId of channelIds) {
    try {
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: {
          agent: {
            select: {
              id: true,
              systemPrompt: true,
              temperature: true,
              maxTokens: true,
              isActive: true,
              providerId: true,
              modelId: true,
              provider: { select: { providerType: true, isActive: true } },
            },
          },
        },
      });
      if (!channel) {
        results.push({ channelId, error: "Canal no encontrado" });
        continue;
      }
      const existing = await prisma.asset.findUnique({
        where: { contentId_channelId: { contentId: content.id, channelId: channel.id } },
      });
      if (existing) {
        results.push({
          channelId,
          existing: { id: existing.id, status: existing.status },
        });
        continue;
      }

      // Prompts compartidos con /api/assets/[id]/regenerate: agente del canal
      // manda → prompt del canal → default; siempre con reglas de veracidad.
      const { systemPrompt, userPrompt, agent: channelAgent } = buildAssetPrompts(
        channel,
        { title: content.title, body: content.body },
        null,
        null,
        brand.designBlock,
      );

      // Modelo/proveedor propios del agente del canal (si los tiene): así el
      // agente de carruseles puede usar un LLM distinto al de otros canales.
      const modelOverride = resolveAgentModel(channelAgent);

      let result = await execute(userId, {
        phase: "ASSET",
        refType: "asset",
        refId: `${content.id}:${channel.id}`,
        agentId: channelAgent?.id,
        systemPrompt,
        userPrompt,
        temperature: channelAgent?.temperature,
        maxTokens: channelAgent?.maxTokens,
        ...modelOverride,
      });
      if (result.status === "ERROR") {
        results.push({ channelId, error: result.error ?? "Error IA" });
        continue;
      }

      // Carrusel: si el modelo devolvió texto plano en vez de documentos HTML,
      // reintenta UNA vez con feedback correctivo; si persiste, error claro.
      // Aplica al canal CAROUSEL y a cualquier output que intente ser carrusel
      // (canal de otro tipo con agente carrusel asignado).
      if (channel.type === "CAROUSEL" || /^===\s*slide/im.test(result.output)) {
        const problem = carouselOutputProblem(result.output);
        if (problem) {
          result = await execute(userId, {
            phase: "ASSET",
            refType: "asset",
            refId: `${content.id}:${channel.id}`,
            agentId: channelAgent?.id,
            systemPrompt,
            userPrompt: userPrompt + carouselRetryInstruction(problem),
            temperature: channelAgent?.temperature,
            maxTokens: channelAgent?.maxTokens,
            ...modelOverride,
          });
          if (result.status === "ERROR") {
            results.push({ channelId, error: result.error ?? "Error IA" });
            continue;
          }
          const stillBad = carouselOutputProblem(result.output);
          if (stillBad) {
            results.push({
              channelId,
              error: `El modelo no devolvió slides HTML válidos tras 2 intentos (${stillBad}). Prueba a regenerar o usa otro proveedor LLM.`,
            });
            continue;
          }
        }
      }

      // El marcador __BRAND_LOGO__ del diseño se sustituye por el logo real
      // (data URI) al guardar — el base64 nunca pasa por el LLM.
      const finalBody = applyBrandLogo(result.output.trim(), brand.logoDataUri);

      const asset = await prisma.asset.create({
        data: {
          contentId: content.id,
          channelId: channel.id,
          body: finalBody,
          status: "READY",
          aiExecutionMode: result.mode,
        },
      });

      // Si es un canal carrusel, además descomponemos el output en ficheros
      // HTML en storage/carousels/<assetId>/ para inspección/depuración.
      if (channel.type === "CAROUSEL") {
        try {
          await writeCarouselFiles(asset.id, finalBody);
        } catch (err) {
          console.error("Error escribiendo ficheros del carrusel:", err);
        }
      }

      results.push({ channelId, asset: { id: asset.id, status: asset.status } });
    } catch (err) {
      console.error(`[produce] canal ${channelId}:`, err);
      results.push({
        channelId,
        // Errores de negocio ("No hay proveedor LLM activo…") que la UI
        // muestra; truncado para no arrastrar stacks de SDK.
        error: err instanceof Error ? err.message.slice(0, 300) : "Error inesperado",
      });
    }
  }

  return {
    ok: true,
    content: { id: content.id, title: content.title },
    contentGenerated,
    results,
  };
}
