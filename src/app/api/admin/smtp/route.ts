import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { getSmtpConfig, saveSmtpConfig, verifySmtp } from "@/lib/mail/smtp";

// Política: admin. Config SMTP (contraseña cifrada; nunca se devuelve en claro).
export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ config: await getSmtpConfig() });
}

const schema = z.object({
  enabled: z.boolean(),
  host: z.string().max(200).nullable().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().max(200).nullable().optional(),
  password: z.string().max(400).optional(), // solo se guarda si viene
  from: z.string().max(200).nullable().optional(),
});

export async function PUT(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  await saveSmtpConfig({
    enabled: parsed.data.enabled,
    host: parsed.data.host ?? null,
    port: parsed.data.port ?? 587,
    secure: parsed.data.secure ?? false,
    user: parsed.data.user ?? null,
    password: parsed.data.password,
    from: parsed.data.from ?? null,
  });
  return NextResponse.json({ ok: true });
}

// POST → prueba la conexión SMTP con lo ya guardado.
export async function POST() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json(await verifySmtp());
}
