import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { produceIdea } from "@/lib/pipeline/produce";

// POST /api/v1/produce — produce el contenido de una idea APPROVED y sus
// creaciones para los canales indicados (misma lógica que la UI: agentes de
// canal, marca, validación de carruseles). Requiere scope read_write.
const schema = z.object({
  ideaId: z.string().min(1).max(128),
  channelIds: z.array(z.string().min(1).max(128)).max(20).optional(),
});

export const maxDuration = 300; // producir varios canales puede tardar

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido: { ideaId, channelIds? }" }, { status: 400 });
  }
  const result = await produceIdea(auth.userId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { content, contentGenerated, results } = result;
  return NextResponse.json({ content, contentGenerated, results }, { status: 201 });
}
