import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { agentPatchSchema } from "@/lib/agents/schema";
import { updateAgentOp } from "@/lib/api/operations";

// PATCH /api/v1/agents/[id] — actualiza un agente de chat: systemPrompt,
//   nombre, rol, temperature, maxTokens, icon, isActive y proveedor/modelo
//   (misma validación que el panel de Agentes). Solo cambia los campos que
//   envíes. Scope read_write.

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = agentPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const result = await updateAgentOp(auth.userId, id, parsed.data);
  if (!result.ok) {
    const status = result.error === "Agente no encontrado" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ agent: result.agent });
}
