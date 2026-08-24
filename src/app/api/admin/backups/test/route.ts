import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { testBackupConnection } from "@/lib/backups/service";

// Política: admin. Probar conexión: escribe y borra un objeto de prueba en spaider/.
export async function POST() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json(await testBackupConnection());
}
