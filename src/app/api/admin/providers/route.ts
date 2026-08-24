import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { listProviders, upsertProvider } from "@/lib/ai/providers";
import { validateApifyToken } from "@/lib/apify/client";
import { validateYouTubeApiKey } from "@/lib/youtube/client";
import { validateTavilyKey } from "@/lib/research/tavily";

// Política: admin
const providerTypes = [
  "OPENAI",
  "ANTHROPIC",
  "OPENROUTER",
  "CUSTOM",
  "ZAI",
  "DEEPSEEK",
  "GEMINI",
  "APIFY",
  "YOUTUBE",
  "TAVILY",
] as const;

const upsertSchema = z.object({
  providerType: z.enum(providerTypes),
  displayName: z.string().min(1).max(120),
  apiKey: z.string().min(4).max(4096),
  baseUrl: z.string().url().max(500).optional().nullable(),
  defaultModel: z.string().max(120).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const providers = await listProviders(guard.user.id);
  return NextResponse.json({ providers });
}

export async function POST(req: Request) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  // Validaciones extra por proveedor — comprobamos el token vs la API real
  // antes de cifrar para evitar guardar credenciales inservibles.
  if (parsed.data.providerType === "APIFY") {
    const check = await validateApifyToken(parsed.data.apiKey);
    if (!check.valid) {
      return NextResponse.json(
        { error: `Token Apify rechazado: ${check.error}` },
        { status: 400 },
      );
    }
  }
  if (parsed.data.providerType === "YOUTUBE") {
    const check = await validateYouTubeApiKey(parsed.data.apiKey);
    if (!check.valid) {
      return NextResponse.json(
        { error: `API key de YouTube rechazada: ${check.error}` },
        { status: 400 },
      );
    }
  }
  if (parsed.data.providerType === "TAVILY") {
    const check = await validateTavilyKey(parsed.data.apiKey);
    if (!check.valid) {
      return NextResponse.json(
        { error: `API key de Tavily rechazada: ${check.error}` },
        { status: 400 },
      );
    }
  }
  const provider = await upsertProvider(guard.user.id, parsed.data);
  return NextResponse.json({ provider }, { status: 201 });
}
