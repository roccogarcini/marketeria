import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BackupRun } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decrypt, encrypt } from "@/lib/crypto";
import { S3Client } from "./s3";
import type { BackupConfigPutInput, BackupFrequency, BackupProvider } from "./schemas";

const execFileAsync = promisify(execFile);

/**
 * Sistema de copias de seguridad: pg_dump → cifrado AES-256-GCM → subida
 * S3-compatible → retención.
 * La configuración vive en AppSetting (secret cifrado con lib/crypto, como el
 * resto de credenciales de la app).
 */

// ── Constantes ────────────────────────────────────────────────────────────────
/** Prefijo de esta app en el bucket: SOLO se escribe/borra dentro de spaider/. */
const PREFIX = "spaider/";
const KEY_RE = /^spaider\/(\d{4}-\d{2}-\d{2})_(\d{4})\.dump\.enc$/;
const TZ = "Europe/Madrid";
const IV_BYTES = 12;
const TAG_BYTES = 16;

const FREQ_MS: Record<"hourly" | "6h" | "12h", number> = {
  hourly: 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
};
/** Frecuencias "de días": corren a la hora configurada cada N días. */
const DAY_INTERVALS: Partial<Record<BackupFrequency, number>> = {
  daily: 1,
  "3d": 3,
  weekly: 7,
  monthly: 30,
};
/** Días entre dos fechas YYYY-MM-DD (pared Madrid). */
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
/** Si la última copia automática falló, se reintenta a la media hora. */
const RETRY_MS = 30 * 60 * 1000;

/** Claves en AppSetting (categoría "backups"). El secret va cifrado. */
const KEYS = {
  provider: "backup_provider",
  endpoint: "backup_endpoint",
  accessKeyId: "backup_access_key_id",
  secret: "backup_secret", // cifrado con lib/crypto (AES-256-GCM)
  bucket: "backup_bucket",
  frequency: "backup_frequency",
  dailyTime: "backup_daily_time",
} as const;

export const BACKUP_SETTING_KEYS: string[] = Object.values(KEYS);

// ── Errores con status HTTP para las rutas ────────────────────────────────────
export class BackupError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

// ── Cifrado del volcado (AES-256-GCM, clave derivada de ENCRYPTION_KEY) ──────
// Formato del blob: [IV 12B][authTag 16B][ciphertext]. Nonce+tag viajan con el blob.
let cachedKey: Buffer | null = null;
function backupKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || raw.length < 32) {
    throw new BackupError("ENCRYPTION_KEY no está configurada (mínimo 32 caracteres)", 500);
  }
  cachedKey = Buffer.from(
    crypto.hkdfSync("sha256", raw, Buffer.alloc(0), Buffer.from("spaider-backup-v1"), 32),
  );
  return cachedKey;
}

function encryptDump(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", backupKey(), iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]);
}

function decryptDump(blob: Buffer): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new BackupError("Copia corrupta: blob demasiado corto");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const data = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", backupKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ── Fechas en Europe/Madrid ───────────────────────────────────────────────────
function madridParts(d = new Date()): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
  };
}

/** Instante UTC de una hora de pared en Madrid (prueba offsets 0..3 h y verifica). */
function madridWallToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  for (const off of [1, 2, 0, 3]) {
    const candidate = new Date(Date.UTC(y, mo - 1, d, hh - off, mm));
    const p = madridParts(candidate);
    if (p.date === date && p.time === time) return candidate;
  }
  // Hora inexistente por cambio horario: aproxima con offset CET.
  return new Date(Date.UTC(y, mo - 1, d, hh - 1, mm));
}

// ── Configuración (AppSetting) ────────────────────────────────────────────────
interface BackupProviderMeta {
  provider: BackupProvider;
  endpoint: string;
  accessKeyId: string;
  bucket: string;
}

async function readSettings(): Promise<Map<string, string>> {
  const rows = await prisma.appSetting.findMany({
    where: { key: { in: BACKUP_SETTING_KEYS } },
  });
  return new Map(rows.map((r) => [r.key, r.value]));
}

async function upsertSetting(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value, category: "backups" },
    update: { value },
  });
}

function metaFrom(byKey: Map<string, string>): BackupProviderMeta | null {
  const endpoint = byKey.get(KEYS.endpoint);
  const accessKeyId = byKey.get(KEYS.accessKeyId);
  const bucket = byKey.get(KEYS.bucket);
  if (!endpoint || !accessKeyId || !bucket) return null;
  return {
    provider: (byKey.get(KEYS.provider) as BackupProvider) || "r2",
    endpoint,
    accessKeyId,
    bucket,
  };
}

function scheduleFrom(byKey: Map<string, string>): { frequency: BackupFrequency; dailyTime: string } {
  const freq = byKey.get(KEYS.frequency);
  const valid: BackupFrequency[] = ["hourly", "6h", "12h", "daily", "3d", "weekly", "monthly"];
  return {
    frequency: valid.includes(freq as BackupFrequency) ? (freq as BackupFrequency) : "daily",
    dailyTime: byKey.get(KEYS.dailyTime) || "04:00",
  };
}

function decryptedSecret(byKey: Map<string, string>): string | null {
  const enc = byKey.get(KEYS.secret);
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

/** Cliente S3 con la credencial guardada, o null si la integración no está completa. */
async function getClient(): Promise<S3Client | null> {
  const byKey = await readSettings();
  const meta = metaFrom(byKey);
  const secretAccessKey = decryptedSecret(byKey);
  if (!meta || !secretAccessKey) return null;
  return new S3Client({
    endpoint: meta.endpoint,
    accessKeyId: meta.accessKeyId,
    secretAccessKey,
    bucket: meta.bucket,
  });
}

export async function saveBackupConfig(input: BackupConfigPutInput): Promise<void> {
  if (input.secretAccessKey) {
    await upsertSetting(KEYS.secret, encrypt(input.secretAccessKey));
  } else {
    // Sin secret nuevo: debe existir uno guardado (el resto de campos se actualiza).
    const byKey = await readSettings();
    if (!decryptedSecret(byKey)) {
      throw new BackupError("Falta la Secret Access Key (aún no hay ninguna guardada)");
    }
  }
  await upsertSetting(KEYS.provider, input.provider);
  await upsertSetting(KEYS.endpoint, input.endpoint.replace(/\/+$/, ""));
  await upsertSetting(KEYS.accessKeyId, input.accessKeyId);
  await upsertSetting(KEYS.bucket, input.bucket);
  await upsertSetting(KEYS.frequency, input.frequency);
  await upsertSetting(KEYS.dailyTime, input.dailyTime);
}

// ── Estado / overview ─────────────────────────────────────────────────────────
export interface BackupRunInfo {
  id: string;
  kind: string;
  status: string;
  objectKey: string | null;
  sizeBytes: number | null;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const toRunInfo = (r: BackupRun): BackupRunInfo => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  objectKey: r.objectKey,
  sizeBytes: r.sizeBytes === null ? null : Number(r.sizeBytes),
  durationMs: r.durationMs,
  error: r.error,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
});

export interface BackupOverview {
  provider: (BackupProviderMeta & { secretConfigured: boolean }) | null;
  frequency: BackupFrequency;
  dailyTime: string;
  configured: boolean;
  lastRun: BackupRunInfo | null;
  lastOk: BackupRunInfo | null;
  nextRunAt: string | null;
}

export async function getBackupOverview(): Promise<BackupOverview> {
  const [byKey, lastRun, lastOk] = await Promise.all([
    readSettings(),
    prisma.backupRun.findFirst({
      where: { kind: { in: ["auto", "manual"] } },
      orderBy: { startedAt: "desc" },
    }),
    prisma.backupRun.findFirst({
      where: { kind: { in: ["auto", "manual"] }, status: "ok" },
      orderBy: { startedAt: "desc" },
    }),
  ]);
  const meta = metaFrom(byKey);
  const schedule = scheduleFrom(byKey);
  const secretConfigured = Boolean(byKey.get(KEYS.secret));
  const configured = Boolean(meta && secretConfigured);
  return {
    provider: meta ? { ...meta, secretConfigured } : null,
    frequency: schedule.frequency,
    dailyTime: schedule.dailyTime,
    configured,
    lastRun: lastRun ? toRunInfo(lastRun) : null,
    lastOk: lastOk ? toRunInfo(lastOk) : null,
    nextRunAt: configured
      ? (await computeNextRunAt(schedule.frequency, schedule.dailyTime)).toISOString()
      : null,
  };
}

async function computeNextRunAt(frequency: BackupFrequency, dailyTime: string): Promise<Date> {
  const lastAuto = await prisma.backupRun.findFirst({
    where: { kind: "auto" },
    orderBy: { startedAt: "desc" },
  });
  const now = new Date();
  const dayInterval = DAY_INTERVALS[frequency];
  if (dayInterval) {
    const today = madridParts(now).date;
    const target = madridWallToUtc(today, dailyTime);
    const lastOkDate = lastAuto?.status === "ok" ? madridParts(lastAuto.startedAt).date : null;
    // Toca cuando han pasado >= N días (pared Madrid) desde la última correcta.
    const doneForNow = lastOkDate != null && daysBetween(lastOkDate, today) < dayInterval;
    if (doneForNow) {
      const [y, m, d] = lastOkDate!.split("-").map(Number);
      const nextDay = new Date(Date.UTC(y, m - 1, d + dayInterval, 12));
      return madridWallToUtc(madridParts(nextDay).date, dailyTime);
    }
    return now < target ? target : now; // pendiente de la próxima pasada del scheduler
  }
  const iv = FREQ_MS[frequency as "hourly" | "6h" | "12h"];
  if (!lastAuto) return now;
  const next = new Date(
    lastAuto.startedAt.getTime() + (lastAuto.status === "ok" ? iv : Math.min(iv, RETRY_MS)),
  );
  return next < now ? now : next;
}

export async function listBackupRuns(): Promise<BackupRunInfo[]> {
  const runs = await prisma.backupRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
  return runs.map(toRunInfo);
}

// ── Probar conexión ───────────────────────────────────────────────────────────
export async function testBackupConnection(): Promise<{ ok: boolean; message: string }> {
  const client = await getClient();
  if (!client) {
    return { ok: false, message: "Integración incompleta: guarda endpoint, claves y bucket primero" };
  }
  const testKey = `${PREFIX}.conexion-test-${Date.now()}`;
  try {
    await client.putObject(testKey, Buffer.from("test de conexión spAIder"));
    await client.deleteObject(testKey);
    return { ok: true, message: "Conexión correcta: se escribió y borró un objeto de prueba" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Fallo desconocido al conectar" };
  }
}

// ── Copia (pg_dump → cifrar → subir → retención) ──────────────────────────────
// Lock en globalThis: sobrevive al HMR de dev igual que lib/prisma.ts.
const globalForBackups = globalThis as unknown as { backupInProgress?: boolean };

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new BackupError("DATABASE_URL no está configurada", 500);
  return url;
}

export async function runBackup(kind: "auto" | "manual"): Promise<BackupRunInfo> {
  if (globalForBackups.backupInProgress) throw new BackupError("Ya hay una copia en curso");
  const client = await getClient();
  if (!client) {
    throw new BackupError("Configura primero el proveedor de copias (endpoint, claves y bucket)");
  }

  globalForBackups.backupInProgress = true;
  const startedAt = new Date();
  const p = madridParts(startedAt);
  const objectKey = `${PREFIX}${p.date}_${p.time.replace(":", "")}.dump.enc`;
  const tmpFile = path.join(os.tmpdir(), `spaider-backup-${Date.now()}.dump`);
  try {
    let run: BackupRun;
    try {
      // 1) Volcado en formato custom (comprimido, restaurable con pg_restore).
      await execFileAsync("pg_dump", ["--format=custom", "--file", tmpFile, databaseUrl()], {
        timeout: 15 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      // 2) Cifrado AES-256-GCM y 3) subida SOLO a la carpeta spaider/ del bucket.
      const encrypted = encryptDump(await fs.readFile(tmpFile));
      await client.putObject(objectKey, encrypted);
      run = await prisma.backupRun.create({
        data: {
          kind,
          status: "ok",
          objectKey,
          sizeBytes: BigInt(encrypted.length),
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
          finishedAt: new Date(),
        },
      });
      console.log(`[backup] copia subida: ${objectKey} (${encrypted.length} B, ${kind})`);
    } catch (err) {
      const message = describeError(err);
      run = await prisma.backupRun.create({
        data: {
          kind,
          status: "error",
          objectKey,
          error: message,
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
          finishedAt: new Date(),
        },
      });
      console.error(`[backup] copia fallida (${objectKey}, ${kind}):`, message);
      return toRunInfo(run);
    }
    // 4) Retención: nunca hace fallar la copia si el borrado de viejas falla.
    try {
      await applyRetention(client);
    } catch (err) {
      console.warn("[backup] retención fallida:", String(err));
    }
    return toRunInfo(run);
  } finally {
    globalForBackups.backupInProgress = false;
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

function describeError(err: unknown): string {
  if (err && typeof err === "object" && (err as NodeJS.ErrnoException).code === "ENOENT") {
    return "pg_dump/pg_restore no está instalado en el servidor (falta postgresql17-client en la imagen)";
  }
  if (err instanceof Error) {
    const stderr = (err as Error & { stderr?: string }).stderr;
    return stderr?.trim() ? `${err.message}: ${stderr.trim().slice(0, 500)}` : err.message;
  }
  return String(err);
}

// ── Retención ─────────────────────────────────────────────────────────────────
/**
 * Política según frecuencia:
 * - diaria → 7 diarias + 4 semanales
 * - mayor frecuencia → últimas 24-48 copias + 7 diarias + 4 semanales
 * Solo borra objetos spaider/<fecha>.dump.enc; nunca toca otras carpetas del bucket.
 */
async function applyRetention(client: S3Client): Promise<void> {
  const { frequency } = scheduleFrom(await readSettings());
  const recentKeep = frequency === "hourly" ? 48 : DAY_INTERVALS[frequency] ? 7 : 24;

  const objects = (await client.listObjects(PREFIX))
    .filter((o) => KEY_RE.test(o.key))
    .sort((a, b) => (a.key < b.key ? 1 : -1)); // más recientes primero (el stamp ordena)

  const keep = new Set<string>();
  // Últimas N copias.
  for (const o of objects.slice(0, recentKeep)) keep.add(o.key);
  // La más reciente de cada uno de los últimos 7 días con copia.
  const days = new Map<string, string>();
  for (const o of objects) {
    const day = KEY_RE.exec(o.key)![1];
    if (!days.has(day)) days.set(day, o.key); // objects ya viene desc: la primera es la más nueva del día
  }
  for (const key of [...days.values()].slice(0, 7)) keep.add(key);
  // La más reciente de cada una de las últimas 4 semanas (bloques de 7 días).
  const weeks = new Map<number, string>();
  for (const [day, key] of days) {
    const week = Math.floor(Date.parse(`${day}T00:00:00Z`) / (7 * 86_400_000));
    if (!weeks.has(week)) weeks.set(week, key);
  }
  for (const key of [...weeks.values()].slice(0, 4)) keep.add(key);

  for (const o of objects) {
    if (keep.has(o.key)) continue;
    await client.deleteObject(o.key);
    console.log(`[backup] retención: borrada copia antigua ${o.key}`);
  }
}

// ── Listado / descarga / restauración ─────────────────────────────────────────
export interface BackupCopy {
  key: string;
  size: number;
  lastModified: string;
}

export async function listRemoteCopies(): Promise<BackupCopy[]> {
  const client = await getClient();
  if (!client) throw new BackupError("Configura primero el proveedor de copias");
  return (await client.listObjects(PREFIX))
    .filter((o) => KEY_RE.test(o.key))
    .sort((a, b) => (a.key < b.key ? 1 : -1));
}

/** Descarga y descifra una copia (o la última si no se indica clave). */
export async function downloadCopy(key?: string): Promise<{ filename: string; data: Buffer }> {
  const client = await getClient();
  if (!client) throw new BackupError("Configura primero el proveedor de copias");
  let target = key;
  if (!target) {
    const copies = await listRemoteCopies();
    if (copies.length === 0) throw new BackupError("No hay ninguna copia en el bucket", 404);
    target = copies[0].key;
  }
  if (!KEY_RE.test(target)) throw new BackupError("Clave de copia no válida");
  const blob = await client.getObject(target);
  if (!blob) throw new BackupError("La copia ya no existe en el bucket", 404);
  const data = decryptDump(blob);
  const filename = target.replace(PREFIX, "spaider-").replace(/\.enc$/, "");
  return { filename, data };
}

/**
 * Restaura una copia PISANDO los datos actuales. La doble confirmación se
 * valida en la ruta (confirm = "RESTAURAR"). pg_restore corre con --clean
 * --if-exists en una única transacción: o restaura todo o no toca nada.
 */
export async function restoreCopy(key: string): Promise<BackupRunInfo> {
  if (globalForBackups.backupInProgress) {
    throw new BackupError("Hay una copia en curso; espera a que termine");
  }
  const client = await getClient();
  if (!client) throw new BackupError("Configura primero el proveedor de copias");

  globalForBackups.backupInProgress = true;
  const startedAt = new Date();
  const tmpFile = path.join(os.tmpdir(), `spaider-restore-${Date.now()}.dump`);
  try {
    const blob = await client.getObject(key);
    if (!blob) throw new BackupError("La copia ya no existe en el bucket", 404);
    await fs.writeFile(tmpFile, decryptDump(blob));
    await execFileAsync(
      "pg_restore",
      [
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        "--single-transaction",
        "--dbname",
        databaseUrl(),
        tmpFile,
      ],
      { timeout: 30 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 },
    );
    const run = await prisma.backupRun.create({
      data: {
        kind: "restore",
        status: "ok",
        objectKey: key,
        sizeBytes: BigInt(blob.length),
        durationMs: Date.now() - startedAt.getTime(),
        startedAt,
        finishedAt: new Date(),
      },
    });
    console.log(`[backup] restauración completada: ${key}`);
    return toRunInfo(run);
  } catch (err) {
    const message = describeError(err);
    console.error(`[backup] restauración fallida (${key}):`, message);
    const run = await prisma.backupRun
      .create({
        data: {
          kind: "restore",
          status: "error",
          objectKey: key,
          error: message,
          durationMs: Date.now() - startedAt.getTime(),
          startedAt,
          finishedAt: new Date(),
        },
      })
      .catch(() => null); // si la BD quedó a medias, no ocultar el error original
    if (run) return toRunInfo(run);
    throw new BackupError(`Restauración fallida: ${message}`);
  } finally {
    globalForBackups.backupInProgress = false;
    await fs.rm(tmpFile, { force: true }).catch(() => undefined);
  }
}

// ── Scheduler (lo llama lib/backups/scheduler.ts cada minuto) ─────────────────
export async function autoBackupTick(): Promise<void> {
  const client = await getClient();
  if (!client) return; // integración sin configurar: no hay nada que hacer
  const { frequency, dailyTime } = scheduleFrom(await readSettings());
  const lastAuto = await prisma.backupRun.findFirst({
    where: { kind: "auto" },
    orderBy: { startedAt: "desc" },
  });
  const now = Date.now();

  let due = false;
  const dayInterval = DAY_INTERVALS[frequency];
  if (dayInterval) {
    const p = madridParts();
    if (p.time >= dailyTime) {
      const lastDate = lastAuto ? madridParts(lastAuto.startedAt).date : null;
      const ranToday = lastDate === p.date;
      // Toca si nunca corrió o la última CORRECTA quedó a >= N días.
      if (!lastAuto) due = true;
      else if (lastAuto.status === "ok") due = daysBetween(lastDate!, p.date) >= dayInterval;
      // Si la de hoy falló, reintenta a la media hora (sin martillear cada minuto).
      else due = !ranToday || now - lastAuto.startedAt.getTime() >= RETRY_MS;
    }
  } else {
    const iv = FREQ_MS[frequency as "hourly" | "6h" | "12h"];
    if (!lastAuto) due = true;
    else if (lastAuto.status === "error") {
      due = now - lastAuto.startedAt.getTime() >= Math.min(iv, RETRY_MS);
    } else due = now - lastAuto.startedAt.getTime() >= iv;
  }

  if (!due) return;
  try {
    await runBackup("auto");
  } catch (err) {
    // runBackup ya registra los fallos de la copia; esto cubre "copia en curso" y similares.
    console.warn("[backup] pasada automática no ejecutada:", String(err));
  }
}
