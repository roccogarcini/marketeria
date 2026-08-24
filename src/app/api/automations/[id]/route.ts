import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { isValidCron, removeSchedule, syncAutomationSchedule } from "@/lib/automations/scheduler";

// Política: admin
const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerType: z.enum(["MANUAL", "SCHEDULED"]).optional(),
  targetType: z.enum(["SOURCE", "ANALYSIS", "PRODUCTION", "ASSET", "RESEARCH_CLI"]).optional(),
  cron: z.string().max(80).nullable().optional(),
  paramsJson: z.string().max(10_000).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  if (parsed.data.cron && !isValidCron(parsed.data.cron)) {
    return NextResponse.json({ error: "Expresión cron inválida" }, { status: 400 });
  }
  const automation = await prisma.automation.update({ where: { id }, data: parsed.data });
  await syncAutomationSchedule(id);
  return NextResponse.json({ automation });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  await prisma.automation.delete({ where: { id } });
  removeSchedule(id);
  return NextResponse.json({ ok: true });
}
