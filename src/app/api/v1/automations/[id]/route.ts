import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { deleteAutomationOp, updateAutomationOp } from "@/lib/api/operations";

// PATCH  /api/v1/automations/[id] — actualiza nombre, brief, cron (misma
//   validación que el panel; cadena vacía o null la deja MANUAL), maxItems,
//   maxAgeMonths e isActive (activar/pausar). Scope read_write.
// DELETE /api/v1/automations/[id] — borra la automatización (runs en cascada)
//   y desprograma su cron. Scope read_write.

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  brief: z.string().min(8).max(4000).optional(),
  cron: z.string().max(80).nullable().optional(),
  maxItems: z.number().int().min(3).max(12).optional(),
  maxAgeMonths: z.number().int().min(1).max(24).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const result = await updateAutomationOp(id, parsed.data);
  if (!result.ok) {
    const status = result.error.includes("no encontrada") ? 404 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ automation: result });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const result = await deleteAutomationOp(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}
