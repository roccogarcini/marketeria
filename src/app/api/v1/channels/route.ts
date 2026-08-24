import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { listChannelsOp } from "@/lib/api/operations";

// GET /api/v1/channels — canales activos (para produce/creations). Scope read.
export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const channels = await listChannelsOp();
  return NextResponse.json({ channels });
}
