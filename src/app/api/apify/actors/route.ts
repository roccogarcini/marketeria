import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getApifyToken, listApifyActors } from "@/lib/apify/client";

// GET /api/apify/actors — actores de la cuenta Apify del usuario. Editor.
export async function GET() {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const token = await getApifyToken(guard.user.id);
  if (!token) {
    return NextResponse.json(
      { error: "No hay token Apify. Configúralo en /admin/proveedores." },
      { status: 400 },
    );
  }
  try {
    const actors = await listApifyActors(token);
    return NextResponse.json({ actors });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "Error listando actores" },
      { status: 502 },
    );
  }
}
