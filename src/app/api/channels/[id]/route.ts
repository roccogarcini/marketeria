import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { channelPatchSchema } from "@/lib/channels/schema";
import { updateChannelOp } from "@/lib/api/operations";

// Política: editor
// Validación y lógica compartidas con /api/v1/channels/[id] y la tool MCP
// update_channel_prompt (channelPatchSchema + updateChannelOp).

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = channelPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const result = await updateChannelOp(guard.user.id, id, parsed.data);
  if (!result.ok) {
    const status = result.error === "Canal no encontrado" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ channel: result.channel });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.channel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
