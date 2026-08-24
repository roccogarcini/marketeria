import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { runAutomation } from "@/lib/automations/runner";

// Política: admin
const schema = z.object({ dryRun: z.boolean().optional() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  const dryRun = parsed.success ? parsed.data.dryRun : false;
  try {
    const result = await runAutomation(id, { dryRun, userId: guard.user.id });
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[automations/run] ${id}:`, err);
    return NextResponse.json(
      { error: "No se pudo ejecutar la automatización" },
      { status: 500 },
    );
  }
}
