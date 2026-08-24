/**
 * Presets amigables de schedule ↔ expresiones cron.
 * Pensado para un formulario que el usuario no-técnico pueda entender.
 *
 * Formato cron estándar 5 campos: "m h dom mon dow"
 *   - minute 0-59
 *   - hour 0-23
 *   - day of month 1-31 o *
 *   - month 1-12 o *
 *   - day of week 0-6 (0=dom) o *
 */

export type SchedulePresetId =
  | "every_hour"
  | "every_n_hours"
  | "daily"
  | "weekdays"
  | "weekly"
  | "custom";

export type ScheduleConfig = {
  preset: SchedulePresetId;
  /** Usado en every_n_hours (2,3,4,6,8,12). */
  everyN?: number;
  /** Usado en daily/weekdays/weekly: "HH:MM" formato 24h. */
  time?: string;
  /** Usado en weekly: día de la semana 0-6 (0=dom). */
  weekday?: number;
  /** Usado en custom: cron raw. */
  rawCron?: string;
};

export const PRESETS: { id: SchedulePresetId; label: string; hint: string }[] = [
  { id: "every_hour", label: "Cada hora", hint: "En el minuto 0 de cada hora." },
  {
    id: "every_n_hours",
    label: "Cada X horas",
    hint: "Se dispara cada N horas desde medianoche.",
  },
  {
    id: "daily",
    label: "Cada día a una hora",
    hint: "Una vez al día a la hora que elijas.",
  },
  {
    id: "weekdays",
    label: "Laborables (L-V)",
    hint: "Lunes a viernes a la hora que elijas.",
  },
  {
    id: "weekly",
    label: "Un día de la semana",
    hint: "Una vez por semana a la hora elegida.",
  },
  {
    id: "custom",
    label: "Personalizado (cron)",
    hint: "Sintaxis cron de 5 campos. Solo si sabes lo que haces.",
  },
];

export const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export const EVERY_N_OPTIONS = [2, 3, 4, 6, 8, 12];

function parseTime(time: string | undefined): { h: number; m: number } {
  if (!time) return { h: 9, m: 0 };
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!match) return { h: 9, m: 0 };
  const h = Math.max(0, Math.min(23, parseInt(match[1], 10)));
  const m = Math.max(0, Math.min(59, parseInt(match[2], 10)));
  return { h, m };
}

/** Construye la expresión cron a partir del preset. */
export function buildCron(cfg: ScheduleConfig): string | null {
  switch (cfg.preset) {
    case "every_hour":
      return "0 * * * *";
    case "every_n_hours": {
      const n = cfg.everyN && EVERY_N_OPTIONS.includes(cfg.everyN) ? cfg.everyN : 6;
      return `0 */${n} * * *`;
    }
    case "daily": {
      const { h, m } = parseTime(cfg.time);
      return `${m} ${h} * * *`;
    }
    case "weekdays": {
      const { h, m } = parseTime(cfg.time);
      return `${m} ${h} * * 1-5`;
    }
    case "weekly": {
      const { h, m } = parseTime(cfg.time);
      const dow = cfg.weekday ?? 1;
      return `${m} ${h} * * ${dow}`;
    }
    case "custom":
      return (cfg.rawCron ?? "").trim() || null;
    default:
      return null;
  }
}

/** Intenta parsear una expresión cron conocida en un preset. "custom" fallback. */
export function parseCron(cron: string | null): ScheduleConfig {
  if (!cron) return { preset: "daily", time: "09:00" };
  const trimmed = cron.trim();
  if (trimmed === "0 * * * *") return { preset: "every_hour" };

  // every_n_hours: "0 */N * * *"
  const mEvery = /^0 \*\/(\d{1,2}) \* \* \*$/.exec(trimmed);
  if (mEvery) {
    const n = parseInt(mEvery[1], 10);
    if (EVERY_N_OPTIONS.includes(n)) {
      return { preset: "every_n_hours", everyN: n };
    }
  }

  // daily: "M H * * *"
  const mDaily = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(trimmed);
  if (mDaily) {
    const m = parseInt(mDaily[1], 10);
    const h = parseInt(mDaily[2], 10);
    return {
      preset: "daily",
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    };
  }

  // weekdays: "M H * * 1-5"
  const mWd = /^(\d{1,2}) (\d{1,2}) \* \* 1-5$/.exec(trimmed);
  if (mWd) {
    const m = parseInt(mWd[1], 10);
    const h = parseInt(mWd[2], 10);
    return {
      preset: "weekdays",
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    };
  }

  // weekly: "M H * * D"
  const mWk = /^(\d{1,2}) (\d{1,2}) \* \* (\d)$/.exec(trimmed);
  if (mWk) {
    const m = parseInt(mWk[1], 10);
    const h = parseInt(mWk[2], 10);
    const dow = parseInt(mWk[3], 10);
    return {
      preset: "weekly",
      time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
      weekday: dow,
    };
  }

  return { preset: "custom", rawCron: trimmed };
}

/** Frase corta humanamente legible del schedule. */
export function humanizeCron(cron: string | null): string {
  if (!cron) return "—";
  const cfg = parseCron(cron);
  switch (cfg.preset) {
    case "every_hour":
      return "Cada hora";
    case "every_n_hours":
      return `Cada ${cfg.everyN} h`;
    case "daily":
      return `Cada día a las ${cfg.time}`;
    case "weekdays":
      return `Laborables a las ${cfg.time}`;
    case "weekly": {
      const wd = WEEKDAYS.find((d) => d.value === cfg.weekday)?.label ?? "?";
      return `${wd} a las ${cfg.time}`;
    }
    case "custom":
      return cron;
  }
}
