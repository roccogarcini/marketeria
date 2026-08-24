import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { deleteIdeaOp, updateIdeaOp } from "@/lib/api/operations";

// PATCH  /api/v1/ideas/[id] — actualiza título, ángulo, justificación,
//   referenceUrl y/o estado (mismas transiciones que el panel). Scope read_write.
// DELETE /api/v1/ideas/[id] — borra la idea y sus contenidos en cascada.
//   Scope read_write.

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  angle: z.string().max(2000).nullable().optional(),
  rationale: z.string().max(4000).nullable().optional(),
  status: z.enum(["DRAFT", "PROPOSED", "APPROVED", "REJECTED", "ARCHIVED"]).optional(),
  referenceUrl: z.string().url().max(1000).nullable().optional(),
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
  const result = await updateIdeaOp(auth.userId, id, parsed.data);
  if (!result.ok) {
    const status = result.error.includes("no encontrada")
      ? 404
      : result.error.startsWith("Transición no permitida")
        ? 409
        : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ idea: result.idea });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const result = await deleteIdeaOp(auth.userId, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json(result);
}
