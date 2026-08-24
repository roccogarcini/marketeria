import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { getApifyToken, runApifyActor } from "@/lib/apify/client";
import {
  PLATFORMS,
  fetchLimitFor,
  rankFindings,
  sanitizeFilters,
  type Platform,
} from "@/lib/apify/platforms";
import { createFindingIfNew } from "@/lib/research/findings";

/**
 * POST /api/research/apify/run
 *
 * Lanzamiento ad-hoc: ejecuta un Actor de Apify según la plataforma elegida y
 * guarda los items como Findings enganchados a la Source destino.
 *
 * Body:
 *   { sourceId, platform, query, maxItems?, actorId?, filters? }
 *
 * `filters` es un objeto plano (key→string|number|boolean) cuyas claves deben
 * coincidir con `PLATFORMS[platform].filters[*].key`. Las claves desconocidas
 * y los valores vacíos se descartan en `sanitizeFilters`.
 *
 * Respuesta: { created, skipped, errorsCount }
 */
const bodySchema = z.object({
  sourceId: z.string().min(1).max(128),
  platform: z.enum(["INSTAGRAM", "TIKTOK", "YOUTUBE", "FACEBOOK", "LINKEDIN", "X"]),
  query: z.string().min(2).max(500),
  maxItems: z.number().int().min(1).max(100).optional().default(30),
  actorId: z.string().max(200).optional(),
  filters: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

export async function POST(req: Request) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const source = await prisma.source.findUnique({
    where: { id: parsed.data.sourceId },
    select: { id: true, isActive: true },
  });
  if (!source) {
    return NextResponse.json({ error: "Source no encontrada" }, { status: 404 });
  }

  const token = await getApifyToken(guard.user.id);
  if (!token) {
    return NextResponse.json(
      {
        error:
          "Token Apify no configurado. Añádelo en /admin/proveedores con tipo APIFY.",
      },
      { status: 409 },
    );
  }

  const platform = parsed.data.platform as Platform;
  const def = PLATFORMS[platform];
  const actorId = parsed.data.actorId || def.defaultActorId;
  const filters = sanitizeFilters(platform, parsed.data.filters ?? {});

  // Con rank (Instagram): se sobremuestrea al actor y luego nos quedamos con
  // los `maxItems` más virales; sin rank, se pide y guarda tal cual.
  const fetchLimit = fetchLimitFor(def, parsed.data.maxItems);
  let items: unknown[] = [];
  try {
    items = await runApifyActor(
      token,
      actorId,
      def.buildInput(parsed.data.query, fetchLimit, filters),
      { maxItems: fetchLimit },
    );
  } catch (err) {
    console.error("[research/apify]:", err);
    return NextResponse.json(
      // Host fijo (api.apify.com): mensaje de la API, accionable; truncado.
      { error: err instanceof Error ? err.message.slice(0, 200) : "Error Apify" },
      { status: 502 },
    );
  }

  let created = 0;
  let skipped = 0;
  let errorsCount = 0;
  const mappedItems = [];
  for (const raw of items) {
    const mapped = def.mapItem(raw);
    if (!mapped) {
      errorsCount++;
      continue;
    }
    mappedItems.push(mapped);
  }
  // Mejores primero; los ya existentes se saltan sin consumir hueco, así el
  // run rellena con los siguientes más virales que aún no tenías.
  for (const mapped of rankFindings(def, mappedItems)) {
    if (created >= parsed.data.maxItems) break;
    const isNew = await createFindingIfNew({
      sourceId: source.id,
      title: mapped.title,
      url: mapped.url,
      snippet: mapped.snippet,
      summary: mapped.summary,
      fullContent: mapped.fullContent,
      author: mapped.author,
      publishedAt: mapped.publishedAt,
      reach: mapped.reach,
      likes: mapped.likes,
      comments: mapped.comments,
      shares: mapped.shares,
      status: "NEW",
    });
    if (isNew) created++;
    else skipped++;
  }

  await prisma.source.update({
    where: { id: source.id },
    data: { lastFetchedAt: new Date() },
  });

  return NextResponse.json({ created, skipped, errorsCount });
}
