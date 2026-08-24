import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { isValidCron, syncAutomationSchedule } from "@/lib/automations/scheduler";

// Política: GET any, POST admin (automatizaciones ejecutan código de sistema)
const createSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(["MANUAL", "SCHEDULED"]),
  cron: z.string().max(80).optional().nullable(),
  targetType: z.enum(["SOURCE", "ANALYSIS", "PRODUCTION", "ASSET", "RESEARCH_CLI"]),
  paramsJson: z.string().max(10_000).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const automations = await prisma.automation.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { runs: true } } },
  });
  return NextResponse.json({ automations });
}

export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  if (parsed.data.triggerType === "SCHEDULED" && !parsed.data.cron) {
    return NextResponse.json({ error: "cron requerido para SCHEDULED" }, { status: 400 });
  }
  if (parsed.data.cron && !isValidCron(parsed.data.cron)) {
    return NextResponse.json({ error: "Expresión cron inválida" }, { status: 400 });
  }
  const automation = await prisma.automation.create({
    data: { ...parsed.data, createdById: guard.user.id },
  });
  await syncAutomationSchedule(automation.id);
  return NextResponse.json({ automation }, { status: 201 });
}
