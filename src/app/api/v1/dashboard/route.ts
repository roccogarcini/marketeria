import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { getDashboardSummaryOp } from "@/lib/api/operations";

// GET /api/v1/dashboard — resumen del pipeline con las mismas cifras que el
// dashboard del panel (hallazgos, fuentes, ideas, creaciones, automatizaciones
// y canales activos). Scope read.

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ summary: await getDashboardSummaryOp() });
}
