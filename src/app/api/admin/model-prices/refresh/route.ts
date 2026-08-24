import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { refreshModelPrices } from "@/lib/ai/pricing";

// Política: admin. Refresco inmediato de tarifas desde el catálogo público de
// OpenRouter (el mismo que corre a diario en el scheduler). Las tarifas con
// source="manual" no se tocan.

export async function POST() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  try {
    const result = await refreshModelPrices();
    return NextResponse.json({ result });
  } catch (err) {
    return NextResponse.json(
      { error: `No se pudo refrescar el catálogo: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
