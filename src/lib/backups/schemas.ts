import { z } from "zod";

export const BackupProviderSchema = z.enum(["r2", "s3", "s3compat"]);
export type BackupProvider = z.infer<typeof BackupProviderSchema>;

export const BackupFrequencySchema = z.enum([
  "hourly",
  "6h",
  "12h",
  "daily",
  "3d",
  "weekly",
  "monthly",
]);
export type BackupFrequency = z.infer<typeof BackupFrequencySchema>;

/** Configuración completa (integración + frecuencia). El secret es opcional al editar: vacío = conservar el guardado. */
export const BackupConfigPutSchema = z
  .object({
    provider: BackupProviderSchema,
    endpoint: z.string().trim().url("Debe ser una URL (https://…)").max(300),
    accessKeyId: z.string().trim().min(1, "Access Key ID obligatorio").max(200),
    secretAccessKey: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().max(500).optional(),
    ),
    bucket: z.string().trim().min(1, "Bucket obligatorio").max(200),
    frequency: BackupFrequencySchema,
    dailyTime: z
      .string()
      .trim()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora en formato HH:MM"),
  })
  .strict();
export type BackupConfigPutInput = z.infer<typeof BackupConfigPutSchema>;

/** Solo objetos spaider/<YYYY-MM-DD_HHmm>.dump.enc son operables (nunca otras carpetas). */
export const BackupKeySchema = z
  .string()
  .regex(/^spaider\/\d{4}-\d{2}-\d{2}_\d{4}\.dump\.enc$/, "Clave de copia no válida");

export const BackupRestoreSchema = z
  .object({
    key: BackupKeySchema,
    // Doble confirmación: la UI exige teclear la palabra y el backend la verifica.
    confirm: z.literal("RESTAURAR", {
      errorMap: () => ({ message: "Escribe RESTAURAR para confirmar" }),
    }),
  })
  .strict();
export type BackupRestoreInput = z.infer<typeof BackupRestoreSchema>;
