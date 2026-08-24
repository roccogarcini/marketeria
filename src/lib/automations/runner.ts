import { prisma } from "@/lib/prisma";
import { runSourceFetch } from "@/lib/research/fetcher";

/**
 * Ejecuta una automatización por su id.
 * Soporta únicamente targetType=SOURCE con params.sourceId. El resto
 * registra un AutomationRun con logsText="not implemented" (dry-run explícito).
 */
export async function runAutomation(automationId: string, opts?: { dryRun?: boolean; userId?: string }) {
  const automation = await prisma.automation.findUnique({ where: { id: automationId } });
  if (!automation) throw new Error("Automation no encontrada");

  // Credenciales: el usuario que dispara (run manual) o el creador (cron).
  const userId = opts?.userId ?? automation.createdById ?? undefined;

  const run = await prisma.automationRun.create({
    data: { automationId, status: "RUNNING" },
  });

  const logs: string[] = [];
  let status: "SUCCESS" | "ERROR" = "SUCCESS";

  try {
    if (opts?.dryRun) {
      logs.push("[dry-run] no se ejecutaron acciones");
    } else if (automation.targetType === "SOURCE") {
      const params = automation.paramsJson ? JSON.parse(automation.paramsJson) : {};
      const sourceId = params.sourceId;
      if (!sourceId) throw new Error("paramsJson.sourceId requerido");
      if (!userId) {
        // Sin dueño no podemos leer sus credenciales (Apify/YouTube/IA). Antes
        // esto se tragaba dentro del fetch y el run salía "SUCCESS con 0".
        throw new Error(
          "La automatización no tiene dueño (createdById). Vuelve a guardarla para asociar tus credenciales.",
        );
      }
      const outcome = await runSourceFetch(sourceId, { userId });

      // Log detallado (visible en el historial de ejecuciones).
      const parts = [`created=${outcome.created}`, `skipped=${outcome.skipped}`];
      if (outcome.researchProvider) parts.push(`provider=${outcome.researchProvider}`);
      if (outcome.researchVia) parts.push(`via=${outcome.researchVia}`);
      logs.push(`[SOURCE] ${parts.join(" ")}`);

      // runSourceFetch captura sus errores en outcome.error y NO relanza: si no
      // lo propagamos, un fetch fallido se reporta como run "SUCCESS con 0
      // hallazgos" (el bug: "el cron dice que se ejecutó pero no hay nada").
      if (outcome.error) {
        status = "ERROR";
        logs.push(`ERROR: ${outcome.error}`);
        if (outcome.researchAttempts?.length) {
          logs.push(`Intentos: ${outcome.researchAttempts.join(" · ")}`);
        }
      } else if (outcome.created === 0) {
        logs.push(
          outcome.skipped > 0
            ? `Aviso: 0 hallazgos NUEVOS (todos ${outcome.skipped} ya existían — duplicados por url).`
            : "Aviso: la búsqueda no devolvió hallazgos (sin resultados en el rango/brief).",
        );
      }
    } else {
      logs.push(`[${automation.targetType}] sin implementación en V1`);
    }
  } catch (err) {
    status = "ERROR";
    logs.push(`ERROR: ${err instanceof Error ? err.message : "desconocido"}`);
  }

  await prisma.automationRun.update({
    where: { id: run.id },
    data: { status, logsText: logs.join("\n"), finishedAt: new Date() },
  });
  await prisma.automation.update({
    where: { id: automationId },
    data: { lastRunAt: new Date() },
  });

  return { runId: run.id, status, logs: logs.join("\n") };
}
