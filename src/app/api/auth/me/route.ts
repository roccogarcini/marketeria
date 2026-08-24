import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";

// Política de acceso: any (requiere sesión válida).
export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;

  return NextResponse.json({
    user: {
      id: guard.user.id,
      email: guard.user.email,
      name: guard.user.name,
      role: guard.user.role,
    },
  });
}
