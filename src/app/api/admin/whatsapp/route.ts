import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  clearWhatsAppSecret,
  getWhatsAppConfig,
  saveWhatsAppConfig,
} from "@/lib/whatsapp/config";

// Política: admin. Secretos del webhook de WhatsApp (cifrados; nunca vuelven
// en claro: la UI solo sabe SI están puestos).
export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const config = await getWhatsAppConfig();
  const source = config.sourceId
    ? await prisma.source.findUnique({
        where: { id: config.sourceId },
        select: { id: true, name: true, _count: { select: { findings: true } } },
      })
    : await prisma.source.findFirst({
        where: { type: "WHATSAPP" },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, _count: { select: { findings: true } } },
      });
  return NextResponse.json({
    config,
    source: source
      ? { id: source.id, name: source.name, findings: source._count.findings }
      : null,
  });
}

const schema = z.object({
  enabled: z.boolean(),
  // Vacío = "no lo he tocado", así que no pisa el que ya está guardado.
  verifyToken: z.string().max(400).optional(),
  appSecret: z.string().max(400).optional(),
});

export async function PUT(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const { enabled, verifyToken, appSecret } = parsed.data;

  // Encender la integración sin los dos secretos deja un webhook que rechaza
  // todo: mejor decirlo aquí que dejar a Meta fallando el alta sin explicación.
  if (enabled) {
    const actual = await getWhatsAppConfig();
    if (!verifyToken && !actual.hasVerifyToken) {
      return NextResponse.json(
        { error: "Falta el token de verificación: sin él Meta no puede dar de alta el webhook." },
        { status: 400 },
      );
    }
    if (!appSecret && !actual.hasAppSecret) {
      return NextResponse.json(
        { error: "Falta el secreto de la app: sin él no se puede comprobar la firma de los eventos." },
        { status: 400 },
      );
    }
  }

  await saveWhatsAppConfig({ enabled, verifyToken, appSecret });
  return NextResponse.json({ ok: true, config: await getWhatsAppConfig() });
}

const deleteSchema = z.object({ secret: z.enum(["verifyToken", "appSecret"]) });

/** Borra un secreto para rotarlo desde cero. La integración se apaga a la vez. */
export async function DELETE(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  await clearWhatsAppSecret(parsed.data.secret);
  // Sin uno de los dos secretos el webhook rechaza todo igualmente; apagarlo
  // deja el estado que se ve en pantalla igual al real.
  await saveWhatsAppConfig({ enabled: false });
  return NextResponse.json({ ok: true, config: await getWhatsAppConfig() });
}
