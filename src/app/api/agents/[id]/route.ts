import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { agentPatchSchema } from "@/lib/agents/schema";
import { updateAgentOp } from "@/lib/api/operations";

// Política: editor
// Validación y lógica compartidas con /api/v1/agents/[id] y la tool MCP
// update_agent_prompt (agentPatchSchema + updateAgentOp).

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = agentPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const result = await updateAgentOp(guard.user.id, id, parsed.data);
  if (!result.ok) {
    const status = result.error === "Agente no encontrado" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ agent: result.agent });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.agent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
