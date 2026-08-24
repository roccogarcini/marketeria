import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { BASE_AGENTS } from "@/lib/agents/base-agents";

// Política: editor.
// Carga los agentes base de marketing de contenidos.
//   - mode "create" (default): idempotente por slug — solo crea los que
//     faltan; NUNCA sobrescribe agentes existentes (aunque estén editados).
//   - mode "restore": además ACTUALIZA los agentes base existentes a la
//     última versión (pisa las ediciones de esos slugs; los agentes propios
//     del usuario con otros slugs no se tocan).
export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  const restore = body?.mode === "restore";

  const existing = await prisma.agent.findMany({
    where: { slug: { in: BASE_AGENTS.map((a) => a.slug) } },
    select: { slug: true },
  });
  const existingSlugs = new Set(existing.map((a) => a.slug));

  const created: string[] = [];
  const updated: string[] = [];
  for (const a of BASE_AGENTS) {
    const data = {
      name: a.name,
      role: a.role,
      systemPrompt: a.systemPrompt,
      temperature: a.temperature,
      maxTokens: a.maxTokens,
      icon: a.icon,
      isActive: true,
    };
    if (existingSlugs.has(a.slug)) {
      if (restore) {
        await prisma.agent.update({ where: { slug: a.slug }, data });
        updated.push(a.slug);
      }
      continue;
    }
    await prisma.agent.create({ data: { slug: a.slug, ...data } });
    created.push(a.slug);
  }

  return NextResponse.json({
    created,
    updated,
    skipped: restore ? [] : [...existingSlugs],
    total: BASE_AGENTS.length,
  });
}
