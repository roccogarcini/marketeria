import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";
import { buildAssetPrompts } from "@/lib/channels/asset-prompt";
import { resolveAgentModel } from "@/lib/ai/agent-model";
import {
  getBrandContext,
  applyBrandLogo,
  stripBrandLogo,
} from "@/lib/brand/prompt";
import { writeCarouselFiles } from "@/lib/carousel/files";
import {
  carouselOutputProblem,
  carouselRetryInstruction,
} from "@/lib/carousel/validate";

// Política: editor
// Regenera el body del asset con LA MISMA lógica de prompts que /api/produce:
// agente asignado al canal (su prompt manda) → prompt del canal → default,
// con reglas de veracidad y formato carrusel si aplica. Se guarda sobre el
// mismo asset (no versión).
const schema = z.object({
  instructions: z.string().max(4000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      content: true,
      channel: {
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
      },
    },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Con correcciones → iteramos sobre la versión actual (cambios quirúrgicos);
  // sin correcciones → rehacemos desde el contenido original. El perfil de
  // marca (voz + identidad visual) se aplica siempre.
  const instructions = parsed.data.instructions?.trim() || null;
  const brand = await getBrandContext();
  // La versión actual va al LLM con el logo reducido a __BRAND_LOGO__ (nunca
  // enviamos el base64 al modelo).
  const { systemPrompt, userPrompt, agent: channelAgent } = buildAssetPrompts(
    asset.channel,
    { title: asset.content.title, body: asset.content.body },
    instructions,
    instructions ? stripBrandLogo(asset.body, brand.logoDataUri) : null,
    brand.designBlock,
  );

  const modelOverride = resolveAgentModel(channelAgent);

  let result = await execute(guard.user.id, {
    phase: "ASSET",
    refType: "asset",
    refId: asset.id,
    agentId: channelAgent?.id,
    systemPrompt,
    userPrompt,
    temperature: channelAgent?.temperature,
    maxTokens: channelAgent?.maxTokens,
    ...modelOverride,
  });
  if (result.status === "ERROR") {
    return NextResponse.json({ error: result.error ?? "Error IA" }, { status: 500 });
  }

  // Carrusel: si el modelo devolvió texto plano en vez de documentos HTML,
  // reintenta UNA vez con feedback correctivo; si persiste, error claro sin
  // machacar la versión actual del asset. Aplica al canal CAROUSEL y a
  // cualquier output que intente ser carrusel (canal de otro tipo con agente
  // carrusel asignado).
  if (asset.channel.type === "CAROUSEL" || /^===\s*slide/im.test(result.output)) {
    const problem = carouselOutputProblem(result.output);
    if (problem) {
      result = await execute(guard.user.id, {
        phase: "ASSET",
        refType: "asset",
        refId: asset.id,
        agentId: channelAgent?.id,
        systemPrompt,
        userPrompt: userPrompt + carouselRetryInstruction(problem),
        temperature: channelAgent?.temperature,
        maxTokens: channelAgent?.maxTokens,
        ...modelOverride,
      });
      if (result.status === "ERROR") {
        return NextResponse.json({ error: result.error ?? "Error IA" }, { status: 500 });
      }
      const stillBad = carouselOutputProblem(result.output);
      if (stillBad) {
        return NextResponse.json(
          {
            error: `El modelo no devolvió slides HTML válidos tras 2 intentos (${stillBad}). La versión actual se conserva. Prueba con otras instrucciones u otro proveedor LLM.`,
          },
          { status: 422 },
        );
      }
    }
  }

  // Sustituir el marcador __BRAND_LOGO__ por el logo real antes de guardar.
  const finalBody = applyBrandLogo(result.output.trim(), brand.logoDataUri);

  const updated = await prisma.asset.update({
    where: { id },
    data: { body: finalBody },
  });

  // Carrusel: mantener los ficheros en disco al día con el nuevo body.
  if (asset.channel.type === "CAROUSEL") {
    try {
      await writeCarouselFiles(asset.id, finalBody);
    } catch (err) {
      console.error("Error escribiendo ficheros del carrusel:", err);
    }
  }

  return NextResponse.json({ asset: updated, result });
}
