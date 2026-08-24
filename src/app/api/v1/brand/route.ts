import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { getBrandOp, updateBrandOp } from "@/lib/api/operations";
import { brandUpdateSchema } from "@/lib/brand/schema";

// GET /api/v1/brand — perfil de marca (tono, voz, audiencia, líneas
//   editoriales, qué evitar, identidad visual). Sin logoDataUri. Scope read.
// PUT /api/v1/brand — actualiza el perfil de marca (mismos campos que el
//   panel /marca, misma validación). Actualización PARCIAL: solo cambia los
//   campos que envíes; null limpia un campo. Scope read_write.

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ brand: await getBrandOp() });
}

export async function PUT(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = brandUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const result = await updateBrandOp(auth.userId, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ brand: result.brand });
}
