import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { brandPutSchema as putSchema } from "@/lib/brand/schema";

// Política: GET any, PUT editor
// BrandProfile es singleton: id fijo 'default'. Solo GET y PUT (upsert). Sin POST ni DELETE.
// Validación por campo compartida con /api/v1/brand y la tool MCP update_brand
// (src/lib/brand/schema.ts). Este PUT es reemplazo completo (el del panel);
// el externo es actualización parcial (updateBrandOp).
const SINGLETON_ID = "default";

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const profile = await prisma.brandProfile.findUnique({ where: { id: SINGLETON_ID } });
  return NextResponse.json({ profile });
}

export async function PUT(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const profile = await prisma.brandProfile.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      name: parsed.data.name,
      tone: parsed.data.tone ?? null,
      voice: parsed.data.voice ?? null,
      audience: parsed.data.audience ?? null,
      editorialLinesJson: parsed.data.editorialLines ? JSON.stringify(parsed.data.editorialLines) : null,
      mustAvoid: parsed.data.mustAvoid ?? null,
      visualIdentity: parsed.data.visualIdentity ?? null,
      logoDataUri: parsed.data.logoDataUri ?? null,
    },
    update: {
      name: parsed.data.name,
      tone: parsed.data.tone ?? null,
      voice: parsed.data.voice ?? null,
      audience: parsed.data.audience ?? null,
      editorialLinesJson: parsed.data.editorialLines ? JSON.stringify(parsed.data.editorialLines) : null,
      mustAvoid: parsed.data.mustAvoid ?? null,
      visualIdentity: parsed.data.visualIdentity ?? null,
      logoDataUri: parsed.data.logoDataUri ?? null,
    },
  });
  return NextResponse.json({ profile });
}
