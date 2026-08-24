import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { listAutomationsOp } from "@/lib/api/operations";

// GET /api/v1/automations?limit=50 — lista automatizaciones con su
// programación legible, si están activas y su última ejecución (scope read).

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const automations = await listAutomationsOp({
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ automations });
}
