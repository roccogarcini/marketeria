import { NextResponse } from "next/server";
import { requireApiKey } from "@/lib/api-keys/auth";
import { listAgentsOp } from "@/lib/api/operations";

// GET /api/v1/agents — agentes de chat con su systemPrompt, proveedor/modelo
// asignado y parámetros de generación. Scope read.

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  return NextResponse.json({ agents: await listAgentsOp() });
}
