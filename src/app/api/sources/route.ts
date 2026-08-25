import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";

// Política: GET any, POST editor
const createSchema = z.object({
  name: z.string().min(1).max(200),
  // AI_RESEARCH = investigación IA: brief en lenguaje natural; al refrescar,
  // busca en la web (nativo o vía Tavily) y crea hallazgos. Brief en configJson.
  // WORDPRESS = entradas de un sitio WordPress vía su REST API pública
  // (/wp-json/wp/v2/posts). `url` es la raíz del sitio; opciones en configJson.
  // El tipo MANUAL no se ofrece en el alta; las existentes siguen siendo
  // legibles. WHATSAPP tampoco: esa fuente la crea el propio webhook la
  // primera vez que entra un mensaje.
  type: z.enum(["URL", "RSS", "APIFY", "YOUTUBE", "AI_RESEARCH", "WORDPRESS"]),
  url: z.string().url().max(1000).optional().nullable(),
  platform: z
    .enum(["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "LINKEDIN", "X"])
    .optional()
    .nullable(),
  configJson: z.string().max(10_000).optional().nullable(),
  frequencyCron: z.string().max(80).optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

export async function GET() {
  const guard = await requireRole("any");
  if (guard instanceof NextResponse) return guard;
  const sources = await prisma.source.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { findings: true } } },
  });
  return NextResponse.json({ sources });
}

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  if (
    (parsed.data.type === "URL" ||
      parsed.data.type === "RSS" ||
      parsed.data.type === "WORDPRESS") &&
    !parsed.data.url
  ) {
    return NextResponse.json(
      { error: "url requerido para tipo URL/RSS/WORDPRESS" },
      { status: 400 },
    );
  }
  if (parsed.data.type === "APIFY") {
    if (!parsed.data.configJson) {
      return NextResponse.json(
        { error: "configJson requerido para APIFY" },
        { status: 400 },
      );
    }
    // El modo "actor dinámico" (configJson.dynamic) no usa platform; el modo
    // por plataforma sí la exige.
    let isDynamic = false;
    try {
      isDynamic = Boolean(JSON.parse(parsed.data.configJson)?.dynamic);
    } catch {
      /* configJson no-JSON → se trata como modo plataforma */
    }
    if (!isDynamic && !parsed.data.platform) {
      return NextResponse.json(
        { error: "platform requerido para tipo APIFY (modo plataforma)" },
        { status: 400 },
      );
    }
  }
  if (parsed.data.type === "YOUTUBE" && !parsed.data.configJson) {
    return NextResponse.json(
      { error: "configJson con {query,maxItems?,order?} requerido para YOUTUBE" },
      { status: 400 },
    );
  }
  if (parsed.data.type === "AI_RESEARCH" && !parsed.data.configJson) {
    return NextResponse.json(
      { error: "configJson con {brief} requerido para AI_RESEARCH" },
      { status: 400 },
    );
  }
  const source = await prisma.source.create({ data: parsed.data });
  await prisma.activity.create({
    data: {
      userId: guard.user.id,
      entityType: "source",
      entityId: source.id,
      action: "create",
    },
  });
  return NextResponse.json({ source }, { status: 201 });
}
