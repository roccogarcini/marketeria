import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: admin
const upsertSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(10_000),
  category: z.string().max(40).optional(),
});

export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const settings = await prisma.appSetting.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ settings });
}

export async function PUT(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const row = await prisma.appSetting.upsert({
    where: { key: parsed.data.key },
    create: {
      key: parsed.data.key,
      value: parsed.data.value,
      category: parsed.data.category ?? "general",
    },
    update: {
      value: parsed.data.value,
      ...(parsed.data.category ? { category: parsed.data.category } : {}),
    },
  });
  return NextResponse.json({ setting: row });
}
