import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { createCreationOp } from "@/lib/api/operations";

// POST /api/v1/creations — inserta una creación YA HECHA fuera (un copy, una
// newsletter…) en Marketería. Crea la traza idea → contenido → creación para que
// aparezca en el pipeline. Canal opcional por id o por tipo/nombre.
// Requiere scope read_write.
const schema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(200_000),
  channelId: z.string().max(128).optional().nullable(),
  channelType: z.string().max(60).optional().nullable(),
  status: z.enum(["READY", "PUBLISHED"]).optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido: { title, body, channelId?|channelType?, status? }" },
      { status: 400 },
    );
  }
  const result = await createCreationOp(auth.userId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result, { status: 201 });
}
