import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { BackupError, runBackup } from "@/lib/backups/service";

// Política: admin. Hacer copia ahora.
export async function POST() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  try {
    const run = await runBackup("manual");
    await prisma.activity.create({
      data: {
        userId: guard.user.id,
        entityType: "BACKUP",
        entityId: run.objectKey ?? "manual",
        action: "backup.run",
        metaJson: JSON.stringify({ status: run.status }),
      },
    });
    return NextResponse.json({ run }, { status: 201 });
  } catch (err) {
    if (err instanceof BackupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
