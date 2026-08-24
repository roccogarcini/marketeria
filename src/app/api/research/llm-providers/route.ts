import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import {
  providerSupportsNativeSearch,
} from "@/lib/research/ai-research";
import type { ProviderType } from "@/lib/ai/providers";

// Política: editor. Lista los proveedores LLM activos del usuario para poblar
// el selector de "Investigar con IA". No expone claves: solo tipo + nombre +
// si el proveedor busca en la web de forma nativa.
const LLM_TYPES: ProviderType[] = [
  "OPENAI",
  "ANTHROPIC",
  "OPENROUTER",
  "CUSTOM",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
];

export async function GET() {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;

  const rows = await prisma.lLMProvider.findMany({
    where: {
      userId: guard.user.id,
      isActive: true,
      providerType: { in: LLM_TYPES },
    },
    select: { providerType: true, displayName: true, isDefaultResearch: true },
    orderBy: { createdAt: "asc" },
  });

  const providers = rows.map((r) => ({
    providerType: r.providerType,
    displayName: r.displayName,
    supportsNativeSearch: providerSupportsNativeSearch(
      r.providerType as ProviderType,
    ),
    isDefault: r.isDefaultResearch,
  }));
  const defaultProvider =
    rows.find((r) => r.isDefaultResearch)?.providerType ?? null;

  // ¿Hay un motor de búsqueda de respaldo (Tavily) configurado? Sirve para
  // avisar en la UI de qué proveedores podrán investigar y cuáles no.
  const tavily = await prisma.lLMProvider.findFirst({
    where: { userId: guard.user.id, isActive: true, providerType: "TAVILY" },
    select: { id: true },
  });

  return NextResponse.json({
    providers,
    defaultProvider,
    hasTavily: Boolean(tavily),
  });
}
