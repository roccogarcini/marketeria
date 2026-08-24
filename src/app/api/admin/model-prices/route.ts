import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MODEL_PRICES } from "@/lib/observability/token-usage";

// Política: admin. Tarifas por modelo ($/1M tokens) para el coste de consumo.

export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const prices = await prisma.modelPrice.findMany({ orderBy: { modelId: "asc" } });
  return NextResponse.json({ prices });
}

const upsertSchema = z.object({
  modelId: z.string().min(1).max(120),
  inputPer1M: z.number().min(0).max(10_000),
  outputPer1M: z.number().min(0).max(10_000),
  currency: z.string().max(8).optional(),
});

// POST crea o actualiza una tarifa (upsert por modelId). Toda tarifa tocada a
// mano queda como source="manual": es un override que el refresco automático
// de OpenRouter respeta (no la pisa).
export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Payload inválido: { modelId, inputPer1M, outputPer1M }" },
      { status: 400 },
    );
  }
  const price = await prisma.modelPrice.upsert({
    where: { modelId: parsed.data.modelId },
    create: {
      modelId: parsed.data.modelId,
      inputPer1M: parsed.data.inputPer1M,
      outputPer1M: parsed.data.outputPer1M,
      currency: parsed.data.currency ?? "USD",
      source: "manual",
    },
    update: {
      inputPer1M: parsed.data.inputPer1M,
      outputPer1M: parsed.data.outputPer1M,
      source: "manual",
      ...(parsed.data.currency ? { currency: parsed.data.currency } : {}),
    },
  });
  return NextResponse.json({ price }, { status: 201 });
}

// PUT sin body: carga las tarifas por defecto que falten (idempotente). Se
// crean como source="auto": son orientativas, así el refresco diario de
// OpenRouter puede corregirlas con el precio real.
export async function PUT() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const existing = new Set(
    (await prisma.modelPrice.findMany({ select: { modelId: true } })).map((p) => p.modelId),
  );
  const created: string[] = [];
  for (const d of DEFAULT_MODEL_PRICES) {
    if (existing.has(d.modelId)) continue;
    await prisma.modelPrice.create({
      data: { modelId: d.modelId, inputPer1M: d.inputPer1M, outputPer1M: d.outputPer1M, source: "auto" },
    });
    created.push(d.modelId);
  }
  return NextResponse.json({ created });
}
