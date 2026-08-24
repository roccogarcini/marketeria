import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: any
export async function GET(req: Request) {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const { searchParams } = new URL(req.url);
  const sourceId = searchParams.get("sourceId") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const q = searchParams.get("q") ?? undefined;
  const findings = await prisma.finding.findMany({
    where: {
      ...(sourceId ? { sourceId } : {}),
      ...(status ? { status } : {}),
      ...(q ? { OR: [{ title: { contains: q } }, { snippet: { contains: q } }] } : {}),
    },
    orderBy: { fetchedAt: "desc" },
    take: 200,
    include: { source: { select: { id: true, name: true, type: true } } },
  });
  return NextResponse.json({ findings });
}
