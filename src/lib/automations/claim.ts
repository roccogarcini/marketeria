import { prisma } from "@/lib/prisma";

/**
 * Reserva ("claim") de un disparo programado, para que la MISMA automatización
 * no se ejecute dos veces si algún día hay más de una réplica del servidor web.
 *
 * Hoy los crons viven dentro del proceso Next (node-cron) y el guard de solape
 * es un `Set` en memoria: con dos réplicas, cada tick del cron dispararía en las
 * dos y cada investigación programada se ejecutaría dos veces (hallazgos
 * duplicados y el doble de coste LLM).
 *
 * La reserva es un UPDATE condicional sobre `Automation.lastRunAt`. Postgres
 * serializa el UPDATE sobre la fila: de dos réplicas que lo intenten a la vez,
 * exactamente una ve `RETURNING id` con una fila; la otra se lleva cero y no
 * ejecuta. No hace falta tabla nueva, ni
 * migración, ni Redis. El reloj es el del servidor de BD (`NOW()`), así que el
 * desfase horario entre réplicas da igual.
 *
 * Solo lo usa el disparo por CRON. Los runs manuales (botón "Ejecutar") no
 * pasan por aquí: son intencionados y deben ejecutarse siempre.
 */
export async function claimScheduledRun(
  automationId: string,
  windowMs: number,
): Promise<boolean> {
  // Ventana 0 = sin reserva (crons de granularidad de segundos): se ejecuta
  // siempre.
  if (windowMs <= 0) return true;
  const seconds = Math.max(1, Math.round(windowMs / 1000));
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "Automation"
         SET "lastRunAt" = NOW()
       WHERE "id" = ${automationId}
         AND ("lastRunAt" IS NULL OR "lastRunAt" < NOW() - make_interval(secs => ${seconds}))
      RETURNING "id"
    `;
    return rows.length > 0;
  } catch (err) {
    // Si la reserva falla (BD caída, permisos), NO nos quedamos sin ejecutar el
    // cron: se registra y se sigue. El fallo que evitamos es la duplicación,
    // que es menos grave que dejar de investigar sin avisar.
    console.error(`[scheduler] no se pudo reservar el turno de ${automationId}:`, err);
    return true;
  }
}

/**
 * Ventana de reserva a partir de la expresión cron.
 *
 * Un cron de 5 campos dispara como mucho una vez por minuto: 30 s bastan para
 * cubrir el desfase entre réplicas sin comerse el siguiente disparo. Con 6
 * campos (segundos) puede haber disparos cada pocos segundos y una ventana fija
 * se tragaría ejecuciones legítimas: ahí se desactiva la reserva.
 */
export function claimWindowMsFor(cronExpr: string): number {
  return cronExpr.trim().split(/\s+/).length >= 6 ? 0 : 30_000;
}
