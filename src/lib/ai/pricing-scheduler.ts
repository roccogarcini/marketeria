import { getPriceRefreshStatus, refreshModelPrices } from "./pricing";

/**
 * Scheduler del refresco diario de tarifas (hermano del de copias de
 * seguridad, lib/backups/scheduler.ts): timer con pasada periódica, sin
 * solaparse y con la primera pasada diferida para que BD y migraciones
 * asienten. Cada tick comprueba contra la última ejecución persistida
 * (AppSetting), así el "cada 24 h" sobrevive a reinicios del proceso.
 *
 * Se arranca desde instrumentation.ts (solo runtime nodejs). El singleton en
 * globalThis evita duplicar timers con el HMR de dev (mismo truco que
 * lib/prisma.ts y lib/backups/scheduler.ts).
 */
const TICK_MS = 15 * 60 * 1000; // comprobación cada 15 min
const FIRST_RUN_DELAY_MS = 3 * 60 * 1000;
const REFRESH_EVERY_MS = 24 * 60 * 60 * 1000; // refresco diario

const globalForPricingScheduler = globalThis as unknown as {
  pricingSchedulerTimer: NodeJS.Timeout | undefined;
  pricingSchedulerTicking: boolean | undefined;
};

async function tick(): Promise<void> {
  if (globalForPricingScheduler.pricingSchedulerTicking) return;
  globalForPricingScheduler.pricingSchedulerTicking = true;
  try {
    const { lastRunAt } = await getPriceRefreshStatus();
    const last = lastRunAt ? Date.parse(lastRunAt) : 0;
    if (Date.now() - last < REFRESH_EVERY_MS) return;
    const result = await refreshModelPrices();
    console.log(
      `[precios] catálogo OpenRouter refrescado: ${result.catalogModels} modelos, ` +
        `${result.created.length} tarifas nuevas, ${result.updated.length} actualizadas` +
        (result.skippedManual.length ? `, ${result.skippedManual.length} manuales respetadas` : ""),
    );
  } catch (err) {
    // Fallo de red o de OpenRouter: se reintenta en el siguiente tick (15 min).
    console.error("[precios] tick del refresco de tarifas fallido:", String(err));
  } finally {
    globalForPricingScheduler.pricingSchedulerTicking = false;
  }
}

export function startPricingScheduler(): void {
  if (globalForPricingScheduler.pricingSchedulerTimer) return; // ya arrancado (HMR)
  setTimeout(() => void tick(), FIRST_RUN_DELAY_MS);
  globalForPricingScheduler.pricingSchedulerTimer = setInterval(() => void tick(), TICK_MS);
  console.log("[precios] scheduler de tarifas programado (refresco diario, comprobación cada 15 min)");
}
