import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { listBackupRuns } from "@/lib/backups/service";

// Política: admin. Registro de intentos (ok/fallo, tamaño, duración).
export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ runs: await listBackupRuns() });
}
