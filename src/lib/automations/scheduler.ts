import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { runAutomation } from "./runner";
import { claimScheduledRun, claimWindowMsFor } from "./claim";

// Singleton en globalThis (mismo patrón que lib/prisma.ts): sobrevive al HMR
// de dev sin duplicar tasks y no crea side-effects al importar el módulo.
const globalForScheduler = globalThis as unknown as {
  automationTasks: Map<string, ScheduledTask> | undefined;
  automationRunning: Set<string> | undefined;
};

const tasks = (globalForScheduler.automationTasks ??= new Map());
const running = (globalForScheduler.automationRunning ??= new Set());

export function isValidCron(expr: string): boolean {
  return cron.validate(expr);
}

export function removeSchedule(automationId: string) {
  tasks.get(automationId)?.stop();
  tasks.delete(automationId);
}

/**
 * Re-sincroniza el cron de una automatización: relee de BD y reprograma
 * solo si sigue activa, SCHEDULED y con expresión válida. Cubre crear,
 * editar, pausar y reactivar con una sola llamada desde las rutas API.
 */
export async function syncAutomationSchedule(automationId: string) {
  removeSchedule(automationId);

  const automation = await prisma.automation.findUnique({ where: { id: automationId } });
  if (!automation?.isActive || automation.triggerType !== "SCHEDULED" || !automation.cron) return;
  if (!cron.validate(automation.cron)) {
    console.error(`[scheduler] cron inválido en "${automation.name}": ${automation.cron}`);
    return;
  }

  const windowMs = claimWindowMsFor(automation.cron);
  const task = cron.schedule(
    automation.cron,
    () => runScheduledTick(automationId, automation.name, windowMs),
    { timezone: process.env.CRON_TZ ?? "Europe/Madrid" },
  );
  tasks.set(automationId, task);
}

/**
 * Un disparo del cron. Exportado para poder probarlo sin esperar al reloj.
 *
 * Dos guards, uno por cada cosa distinta:
 *  - `running` (memoria): evita solapes DENTRO de este proceso si el run
 *    anterior aún no ha terminado.
 *  - `claimScheduledRun` (BD): evita que dos réplicas ejecuten el mismo tick.
 */
export async function runScheduledTick(
  automationId: string,
  name: string,
  windowMs: number,
): Promise<void> {
  if (running.has(automationId)) return;
  running.add(automationId);
  try {
    if (!(await claimScheduledRun(automationId, windowMs))) {
      console.log(`[scheduler] "${name}": turno ya reservado por otra instancia, se omite`);
      return;
    }
    await runAutomation(automationId);
  } catch (err) {
    console.error(`[scheduler] error ejecutando "${name}":`, err);
  } finally {
    running.delete(automationId);
  }
}

/** Registra todos los crons al arrancar el servidor (instrumentation.ts). */
export async function syncAllSchedules() {
  for (const id of [...tasks.keys()]) removeSchedule(id);

  const scheduled = await prisma.automation.findMany({
    where: { triggerType: "SCHEDULED", isActive: true, cron: { not: null } },
    select: { id: true },
  });
  for (const { id } of scheduled) await syncAutomationSchedule(id);
  console.log(`[scheduler] ${tasks.size} automatizaciones programadas registradas`);
}
