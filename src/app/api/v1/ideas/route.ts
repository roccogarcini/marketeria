import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { createIdeaOp, listIdeasOp } from "@/lib/api/operations";

// GET  /api/v1/ideas?status=APPROVED&limit=25 — lista ideas (scope read).
// POST /api/v1/ideas — crea una idea (scope read_write). approved=true por
// defecto → queda lista para producir.

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const ideas = await listIdeasOp({
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ ideas });
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  angle: z.string().max(2000).optional().nullable(),
  rationale: z.string().max(4000).optional().nullable(),
  referenceUrl: z.string().url().max(1000).optional().nullable(),
  approved: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const idea = await createIdeaOp(auth.userId, parsed.data);
  return NextResponse.json({ idea }, { status: 201 });
}
