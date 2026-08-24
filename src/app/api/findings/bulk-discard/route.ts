import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: editor
const schema = z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(500) });

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const result = await prisma.finding.updateMany({
    where: { id: { in: parsed.data.ids } },
    data: { status: "DISCARDED" },
  });
  return NextResponse.json({ updated: result.count });
}
