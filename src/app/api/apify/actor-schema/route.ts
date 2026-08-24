import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getApifyToken, getApifyActorSchema } from "@/lib/apify/client";

// GET /api/apify/actor-schema?actorId=user~actor — input schema del actor. Editor.
export async function GET(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const actorId = new URL(req.url).searchParams.get("actorId")?.trim();
  if (!actorId) {
    return NextResponse.json({ error: "Falta actorId" }, { status: 400 });
  }
  const token = await getApifyToken(guard.user.id);
  if (!token) {
    return NextResponse.json(
      { error: "No hay token Apify. Configúralo en /admin/proveedores." },
      { status: 400 },
    );
  }
  try {
    const schema = await getApifyActorSchema(token, actorId);
    if (!schema) {
      return NextResponse.json(
        { error: "No se pudo leer el esquema de entrada de este actor." },
        { status: 404 },
      );
    }
    return NextResponse.json({ schema });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message.slice(0, 200) : "Error obteniendo el esquema" },
      { status: 502 },
    );
  }
}
