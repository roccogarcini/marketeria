import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { BackupConfigPutSchema } from "@/lib/backups/schemas";
import { BackupError, getBackupOverview, saveBackupConfig } from "@/lib/backups/service";

// Política: admin. Copias de seguridad — estado + configuración.
// El secret nunca se devuelve; solo si está configurado.
export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ overview: await getBackupOverview() });
}

export async function PUT(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = BackupConfigPutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Payload inválido";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  try {
    await saveBackupConfig(parsed.data);
  } catch (err) {
    if (err instanceof BackupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
  await prisma.activity.create({
    data: { userId: guard.user.id, entityType: "BACKUP", entityId: "config", action: "backup.config" },
  });
  return NextResponse.json({ ok: true });
}
