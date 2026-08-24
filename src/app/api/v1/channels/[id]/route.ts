import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { channelPromptPatchSchema } from "@/lib/channels/schema";
import { updateChannelOp } from "@/lib/api/operations";

// PATCH /api/v1/channels/[id] — actualiza el prompt editorial de un canal:
//   systemPrompt, templateMarkdown y constraintsJson (misma validación que el
//   panel de Canales; null limpia el campo). Solo cambia los campos que
//   envíes. Scope read_write.

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = channelPromptPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const result = await updateChannelOp(auth.userId, id, parsed.data);
  if (!result.ok) {
    const status = result.error === "Canal no encontrado" ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ channel: result.channel });
}
