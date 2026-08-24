import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { BackupRestoreSchema } from "@/lib/backups/schemas";
import { BackupError, restoreCopy } from "@/lib/backups/service";

// Política: admin. Restaurar (PISA los datos actuales): exige confirm = "RESTAURAR".
export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = BackupRestoreSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Payload inválido";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  try {
    const run = await restoreCopy(parsed.data.key);
    await prisma.activity
      .create({
        data: {
          userId: guard.user.id,
          entityType: "BACKUP",
          entityId: parsed.data.key,
          action: "backup.restore",
          metaJson: JSON.stringify({ status: run.status }),
        },
      })
      .catch(() => undefined); // el restore pudo tocar la tabla Activity
    return NextResponse.json({ run });
  } catch (err) {
    if (err instanceof BackupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
