/**
 * Scheduler de copias de seguridad: timer con pasada cada minuto, sin
 * solaparse y con la primera pasada diferida para que BD y migraciones
 * asienten. Cada tick decide
 * si toca copia según la frecuencia configurada (cada hora / 6 h / 12 h /
 * diaria a una hora Madrid).
 *
 * Se arranca desde instrumentation.ts (solo runtime nodejs). El singleton en
 * globalThis evita duplicar timers con el HMR de dev (mismo truco que
 * lib/prisma.ts y lib/automations/scheduler.ts).
 */
const TICK_MS = 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

const globalForBackupScheduler = globalThis as unknown as {
  backupSchedulerTimer: NodeJS.Timeout | undefined;
  backupSchedulerTicking: boolean | undefined;
};

async function tick(): Promise<void> {
  if (globalForBackupScheduler.backupSchedulerTicking) return; // no solapar (una copia grande puede tardar más de un tick)
  globalForBackupScheduler.backupSchedulerTicking = true;
  try {
    const { autoBackupTick } = await import("./service");
    await autoBackupTick();
  } catch (err) {
    console.error("[backup] tick del scheduler fallido:", String(err));
  } finally {
    globalForBackupScheduler.backupSchedulerTicking = false;
  }
}

export function startBackupScheduler(): void {
  if (globalForBackupScheduler.backupSchedulerTimer) return; // ya arrancado (HMR)
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS);
  globalForBackupScheduler.backupSchedulerTimer = setInterval(() => void tick(), TICK_MS);
  console.log("[backup] scheduler de copias programado (comprobación cada minuto)");
}
