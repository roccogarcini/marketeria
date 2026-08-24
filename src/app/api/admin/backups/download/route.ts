import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { BackupKeySchema } from "@/lib/backups/schemas";
import { BackupError, downloadCopy } from "@/lib/backups/service";

// Política: admin. Descarga descifrada (?key=spaider/… — sin key, la última copia).
export async function GET(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const raw = new URL(req.url).searchParams.get("key");
  let key: string | undefined;
  if (raw) {
    const parsed = BackupKeySchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json({ error: "Clave de copia no válida" }, { status: 400 });
    }
    key = parsed.data;
  }

  try {
    const { filename, data } = await downloadCopy(key);
    await prisma.activity.create({
      data: {
        userId: guard.user.id,
        entityType: "BACKUP",
        entityId: key ?? "latest",
        action: "backup.download",
      },
    });
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (err) {
    if (err instanceof BackupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
