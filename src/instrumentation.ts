/**
 * Arranque del servidor: registra los crons de las automatizaciones SCHEDULED,
 * el scheduler de copias de seguridad y el refresco diario de tarifas de
 * modelos (OpenRouter). El import dinámico dentro del guard es obligatorio —
 * instrumentation.ts también se evalúa en el runtime edge, donde
 * node-cron/Prisma no existen.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { syncAllSchedules } = await import("@/lib/automations/scheduler");
    await syncAllSchedules();
    const { startBackupScheduler } = await import("@/lib/backups/scheduler");
    startBackupScheduler();
    const { startPricingScheduler } = await import("@/lib/ai/pricing-scheduler");
    startPricingScheduler();
  }
}
