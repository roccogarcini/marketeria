import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { runResearchOp } from "@/lib/api/operations";

// POST /api/v1/research — lanza una investigación IA (brief → hallazgos).
// Requiere scope read_write (crea fuente + hallazgos).
const schema = z.object({
  brief: z.string().min(8).max(4000),
  maxItems: z.number().int().min(3).max(12).optional(),
  // Antigüedad máxima de los hallazgos (meses). Default 6; se ignora si el
  // brief pide contenido histórico.
  maxAgeMonths: z.number().int().min(1).max(24).optional(),
});

export const maxDuration = 300; // la búsqueda web puede tardar

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido: { brief, maxItems? }" }, { status: 400 });
  }
  const result = await runResearchOp(
    auth.userId,
    parsed.data.brief,
    parsed.data.maxItems,
    parsed.data.maxAgeMonths,
  );
  if (result.error) {
    return NextResponse.json(result, { status: 502 });
  }
  return NextResponse.json(result, { status: 201 });
}
