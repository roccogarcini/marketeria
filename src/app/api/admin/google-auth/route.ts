import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { getGoogleAuthAdminView, saveGoogleAuth } from "@/lib/auth/google-auth";

// Política: admin. El client secret nunca se devuelve (solo enmascarado).

export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const view = await getGoogleAuthAdminView();
  return NextResponse.json(view);
}

const putSchema = z
  .object({
    enabled: z.boolean().optional(),
    clientId: z.string().max(300).optional(),
    // Vacío = conservar el secret guardado.
    clientSecret: z.string().max(300).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });

export async function PUT(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  await saveGoogleAuth(parsed.data);
  const view = await getGoogleAuthAdminView();
  return NextResponse.json(view);
}
