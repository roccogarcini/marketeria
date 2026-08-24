import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { BackupError, listRemoteCopies } from "@/lib/backups/service";

// Política: admin. Copias disponibles en el bucket (para descargar/restaurar).
export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  try {
    return NextResponse.json({ copies: await listRemoteCopies() });
  } catch (err) {
    if (err instanceof BackupError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
