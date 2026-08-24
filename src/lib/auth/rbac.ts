import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { UserRole } from "@/types/next-auth";

/**
 * Helpers de RBAC para Route Handlers (src/app/api/**).
 *
 * Política:
 *  - `public`  → la ruta se declara explícitamente pública; no se llama a estas helpers.
 *  - `any`     → cualquier sesión válida (ADMIN/EDITOR/VIEWER).
 *  - `editor`  → ADMIN o EDITOR.
 *  - `admin`   → solo ADMIN.
 *
 * Uso:
 *   const guard = await requireRole("editor");
 *   if (guard instanceof NextResponse) return guard;
 *   const { user } = guard;
 */
export type AuthGuard = {
  user: { id: string; role: UserRole; email: string; name: string };
};

export async function requireAuth(): Promise<AuthGuard | NextResponse> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return {
    user: {
      id: user.id,
      role: user.role,
      email: user.email ?? "",
      name: user.name ?? "",
    },
  };
}

export async function requireRole(
  policy: "any" | "editor" | "admin",
): Promise<AuthGuard | NextResponse> {
  const guard = await requireAuth();
  if (guard instanceof NextResponse) return guard;

  const { role } = guard.user;
  if (policy === "any") return guard;
  if (policy === "editor" && (role === "ADMIN" || role === "EDITOR")) return guard;
  if (policy === "admin" && role === "ADMIN") return guard;

  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
