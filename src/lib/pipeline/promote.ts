import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";
import { resolveAgentModel } from "@/lib/ai/agent-model";
import { enrichFinding } from "@/lib/research/enrich";
import { bestMaterial } from "@/lib/research/material";

/**
 * Promoción "hallazgo → idea APPROVED", extraída del route handler para
 * reutilizarla desde el endpoint individual y el masivo.
 *
 * Efectos:
 *   1. Enriquece el hallazgo (best-effort): descarga el contenido completo.
 *   2. Si el agente "ideador" está activo, propone ángulo + justificación
 *      anclados al material (best-effort; si falla, se promueve igual).
 *   3. Crea la traza AnalysisRun → Insight → Idea (status APPROVED).
 *   4. Marca el hallazgo como PROMOTED.
 */
export type PromoteResult =
  | { ok: true; idea: { id: string; title: string; status: string } }
  | { ok: false; status: number; error: string };

export async function promoteFindingToIdea(
  userId: string,
  findingId: string,
): Promise<PromoteResult> {
  let finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: {
      id: true,
      title: true,
      summary: true,
      snippet: true,
      fullContent: true,
      url: true,
      status: true,
    },
  });
  if (!finding) return { ok: false, status: 404, error: "Finding no encontrado" };
  if (finding.status === "PROMOTED") {
    return { ok: false, status: 409, error: "Este finding ya fue promocionado a idea" };
  }

  // 1) Enriquecer antes de idear: si no había fullContent, lo intentamos traer.
  if (!finding.fullContent) {
    const enriched = await enrichFinding(finding.id);
    if (enriched.status === "enriched") {
      finding = {
        ...finding,
        fullContent:
          (
            await prisma.finding.findUnique({
              where: { id: finding.id },
              select: { fullContent: true },
            })
          )?.fullContent ?? null,
      };
    }
  }

  let rationale = finding.summary ?? finding.snippet ?? null;
  let angle: string | null = null;

  // 2) Agente "ideador" (si existe y está activo): ángulo + justificación.
  const material = bestMaterial(finding);
  const ideador = await prisma.agent.findFirst({
    where: { slug: "ideador", isActive: true },
    select: {
      id: true,
      systemPrompt: true,
      temperature: true,
      maxTokens: true,
      providerId: true,
      modelId: true,
      provider: { select: { providerType: true, isActive: true } },
    },
  });
  if (ideador && material) {
    try {
      const r = await execute(userId, {
        phase: "IDEATION",
        agentId: ideador.id,
        refType: "finding",
        refId: finding.id,
        systemPrompt:
          ideador.systemPrompt +
          "\n\nDevuelves ÚNICAMENTE un objeto JSON con esta forma exacta (sin markdown fence ni texto extra):\n" +
          '{ "angle": "ángulo editorial en 1 frase (máx 200 chars)", "rationale": "por qué merece contenido, 2-4 frases ancladas al material (máx 800 chars)" }',
        userPrompt:
          `Titular: ${finding.title}\n\n` +
          `Material fuente (única fuente de verdad; no inventes nada que no esté aquí):\n${material.slice(0, 8000)}`,
        temperature: ideador.temperature,
        maxTokens: Math.min(ideador.maxTokens, 800),
        ...resolveAgentModel(ideador),
      });
      if (r.status === "SUCCESS") {
        const jsonMatch = r.output.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            angle?: string;
            rationale?: string;
          };
          if (typeof parsed.angle === "string" && parsed.angle.trim()) {
            angle = parsed.angle.trim().slice(0, 300);
          }
          if (typeof parsed.rationale === "string" && parsed.rationale.trim()) {
            rationale = parsed.rationale.trim().slice(0, 2000);
          }
        }
      }
    } catch (err) {
      console.warn("[promote-to-idea] ideador falló (se promueve sin ángulo IA):", err);
    }
  }

  const idea = await prisma.$transaction(async (tx) => {
    const run = await tx.analysisRun.create({
      data: {
        name: `Promoción manual · ${finding.title.slice(0, 80)}`,
        findingIdsJson: JSON.stringify([finding.id]),
        executionMode: "API",
        status: "SUCCESS",
        summary: "Promoción directa del hallazgo a idea aprobada.",
      },
      select: { id: true },
    });
    const insight = await tx.insight.create({
      data: {
        analysisRunId: run.id,
        title: finding.title.slice(0, 300),
        description: rationale ?? finding.title,
        relevanceScore: 1,
      },
      select: { id: true },
    });
    const created = await tx.idea.create({
      data: {
        title: finding.title.slice(0, 300),
        angle,
        rationale,
        referenceUrl: finding.url,
        status: "APPROVED",
        insightId: insight.id,
        createdById: userId,
        decidedById: userId,
        decidedAt: new Date(),
      },
      select: { id: true, title: true, status: true },
    });
    await tx.finding.update({
      where: { id: finding.id },
      data: { status: "PROMOTED" },
    });
    return created;
  });

  return { ok: true, idea };
}
