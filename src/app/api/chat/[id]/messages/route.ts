import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { execute } from "@/lib/ai/router";
import { runAgentChat } from "@/lib/ai/chat-agent";
import { buildAppContextSnapshot } from "@/lib/ai/agent-tools";

export const maxDuration = 120; // el tool-calling encadena varias llamadas

// Política: any — solo el dueño
const schema = z.object({
  content: z.string().min(1).max(10_000),
  agentId: z.string().min(1).max(128).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const session = await prisma.chatSession.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 20 } },
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (session.userId !== guard.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Guarda mensaje del usuario
  await prisma.chatMessage.create({
    data: { sessionId: id, role: "user", content: parsed.data.content },
  });

  // Compone contexto
  const agent = parsed.data.agentId
    ? await prisma.agent.findUnique({ where: { id: parsed.data.agentId } })
    : null;

  const systemPrompt =
    agent?.systemPrompt ??
    "Eres un asistente editorial senior de Marketería. Responde en español, conciso y útil.";

  // ── Vía agéntica: el agente usa herramientas para ver/registrar datos ────
  // Solo si hay un proveedor compatible con tool-calling (no Anthropic).
  try {
    const agentic = await runAgentChat(guard.user.id, {
      systemPrompt,
      history: session.messages.map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      })),
      userMessage: parsed.data.content,
      temperature: agent?.temperature,
      maxTokens: agent?.maxTokens,
      agentId: agent?.id,
      agentProviderId: agent?.providerId,
      agentModel: agent?.modelId,
    });
    if (agentic) {
      const assistant = await prisma.chatMessage.create({
        data: {
          sessionId: id,
          role: "assistant",
          content: agentic.output,
          tokens: agentic.inputTokens + agentic.outputTokens || null,
          aiExecutionMode: "API",
        },
      });
      await prisma.chatSession.update({ where: { id }, data: { updatedAt: new Date() } });
      return NextResponse.json({
        message: assistant,
        executionMode: "API",
        toolsUsed: agentic.toolsUsed,
      });
    }
  } catch (err) {
    console.error("[chat] vía agéntica falló, se usa el chat normal:", err);
    // Cae al chat normal de abajo.
  }

  // ── Vía normal (sin herramientas): fallback ──────────────────────────────
  // Sin tool-calling (proveedor incompatible o que rechaza `tools`, p. ej.
  // z.ai) el agente no puede consultar la app → se le inyecta una foto
  // compacta de los datos reales para que aun así tenga visibilidad.
  let appContext = "";
  try {
    appContext =
      "\n\nDATOS ACTUALES DE LA APP (ya consultados por el sistema; úsalos como " +
      "fuente cuando el usuario pregunte por hallazgos, ideas, canales o marca — " +
      "no digas que no tienes acceso):\n" +
      (await buildAppContextSnapshot());
  } catch {
    /* sin foto de contexto — el chat sigue funcionando */
  }

  const history = [
    ...session.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    `USER: ${parsed.data.content}`,
  ].join("\n\n");

  const result = await execute(guard.user.id, {
    phase: "CHAT",
    agentId: agent?.id,
    refType: "chat_session",
    refId: session.id,
    systemPrompt: systemPrompt + appContext,
    userPrompt: history,
    temperature: agent?.temperature,
    maxTokens: agent?.maxTokens,
  });

  if (result.status === "ERROR") {
    await prisma.chatMessage.create({
      data: { sessionId: id, role: "system", content: `Error: ${result.error}` },
    });
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  const assistant = await prisma.chatMessage.create({
    data: {
      sessionId: id,
      role: "assistant",
      content: result.output,
      tokens: result.tokenUsage?.totalTokens ?? null,
      // Siempre "API"; se conserva por trazabilidad.
      aiExecutionMode: result.mode,
    },
  });
  await prisma.chatSession.update({
    where: { id },
    data: { updatedAt: new Date() },
  });
  return NextResponse.json({ message: assistant, executionMode: result.mode });
}
