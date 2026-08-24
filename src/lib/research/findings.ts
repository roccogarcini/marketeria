import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Alta de hallazgos con deduplicación por (sourceId, url).
 *
 * Comprobar con `findFirst` y crear después no basta: entre las dos consultas
 * hay una ventana en la que otra ejecución de la misma fuente (cron +
 * lanzamiento manual, dos automatizaciones solapadas…) puede insertar el mismo
 * hallazgo, y el resultado son duplicados silenciosos.
 *
 * Quien decide es el índice único `@@unique([sourceId, url])` de Finding:
 * intentamos el insert y tratamos la violación de unicidad (P2002) como "ya
 * existía". `url` null nunca colisiona (semántica NULL de Postgres), así que
 * los hallazgos sin URL se insertan siempre.
 */

/** ¿El error es una violación de índice único de Prisma/Postgres (P2002)? */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Crea el hallazgo salvo que ya exista otro con la misma (sourceId, url).
 * Devuelve true si se creó, false si era duplicado.
 *
 * La comprobación previa está por eficiencia: evita el insert (y su log de
 * error) en el caso normal —un fetch de RSS repetido son decenas de hallazgos
 * ya vistos—. La garantía real es el índice único: si otra ejecución se cuela
 * entre la lectura y la escritura, corta y lo contamos como duplicado en vez
 * de insertarlo.
 */
export async function createFindingIfNew(
  data: Prisma.FindingUncheckedCreateInput,
): Promise<boolean> {
  if (data.url) {
    const existing = await prisma.finding.findFirst({
      where: { sourceId: data.sourceId, url: data.url },
      select: { id: true },
    });
    if (existing) return false;
  }
  try {
    await prisma.finding.create({ data });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}
