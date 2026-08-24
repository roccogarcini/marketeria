import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { listAutomationRunsOp } from "@/lib/api/operations";

// GET /api/v1/automations/[id]/runs?limit=30 — historial de ejecuciones
// (estado, fechas y log recortado). Scope read.

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const url = new URL(req.url);
  const result = await listAutomationRunsOp(
    id,
    Number(url.searchParams.get("limit")) || undefined,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ runs: result.runs });
}
