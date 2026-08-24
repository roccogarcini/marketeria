import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { listAssetsOp } from "@/lib/api/operations";

// GET /api/v1/assets?channelId=&status=READY&limit=20 — lista creaciones con
// su cuerpo completo (incluye slides HTML de carruseles). Scope read.
// Con `includeBody=false` devuelve tamaño + extracto en vez del cuerpo: sirve
// para explorar sin descargar decenas de KB por creación.
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const assets = await listAssetsOp({
    channelId: url.searchParams.get("channelId") ?? undefined,
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
    includeBody: url.searchParams.get("includeBody") === "false" ? false : undefined,
  });
  return NextResponse.json({ assets });
}
