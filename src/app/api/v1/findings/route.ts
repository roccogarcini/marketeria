import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiKey } from "@/lib/api-keys/auth";
import { createFindingOp, listFindingsOp } from "@/lib/api/operations";

// GET  /api/v1/findings?status=NEW&limit=25 — lista hallazgos (scope read).
// POST /api/v1/findings — inserta un hallazgo externo (scope read_write).

export async function GET(req: Request) {
  const auth = await requireApiKey(req);
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const findings = await listFindingsOp({
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ findings });
}

const createSchema = z.object({
  title: z.string().min(1).max(300),
  url: z.string().url().max(1000).optional().nullable(),
  snippet: z.string().max(500).optional().nullable(),
  summary: z.string().max(20_000).optional().nullable(),
  author: z.string().max(200).optional().nullable(),
  publishedAt: z.string().datetime().optional().nullable(),
});

export async function POST(req: Request) {
  const auth = await requireApiKey(req, { write: true });
  if (auth instanceof NextResponse) return auth;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Payload inválido" }, { status: 400 });
  }
  const finding = await createFindingOp({
    ...parsed.data,
    publishedAt: parsed.data.publishedAt ? new Date(parsed.data.publishedAt) : null,
  });
  return NextResponse.json({ finding }, { status: 201 });
}
