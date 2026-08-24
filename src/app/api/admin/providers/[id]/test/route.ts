import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { pingProvider } from "@/lib/ai/api";
import type { ProviderType } from "@/lib/ai/providers";
import { validateApifyToken } from "@/lib/apify/client";
import { validateYouTubeApiKey } from "@/lib/youtube/client";
import { validateTavilyKey } from "@/lib/research/tavily";

/**
 * POST /api/admin/providers/[id]/test
 * Comprueba que la clave guardada del proveedor funciona de verdad contra su
 * API (LLM → completion mínima; APIFY/YOUTUBE/TAVILY → su validador). Política: admin.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;

  const provider = await prisma.lLMProvider.findFirst({
    where: { id, userId: guard.user.id },
  });
  if (!provider) {
    return NextResponse.json({ error: "Proveedor no encontrado" }, { status: 404 });
  }

  let apiKey: string;
  try {
    apiKey = decrypt(provider.encryptedApiKey);
  } catch {
    return NextResponse.json(
      { ok: false, error: "No se pudo descifrar la clave." },
      { status: 200 },
    );
  }

  const type = provider.providerType as ProviderType;
  try {
    if (type === "APIFY") {
      const c = await validateApifyToken(apiKey);
      if (!c.valid) return NextResponse.json({ ok: false, error: c.error });
      return NextResponse.json({ ok: true, detail: `Apify · ${c.username}` });
    }
    if (type === "YOUTUBE") {
      const c = await validateYouTubeApiKey(apiKey);
      return c.valid
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: c.error });
    }
    if (type === "TAVILY") {
      const c = await validateTavilyKey(apiKey);
      return c.valid
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ ok: false, error: c.error });
    }
    // LLM
    await pingProvider(type, apiKey, provider.baseUrl, provider.defaultModel);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message.slice(0, 200) : "Error desconocido",
    });
  }
}
