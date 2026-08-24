"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Check,
  CloudUpload,
  DatabaseBackup,
  Download,
  HardDrive,
  History,
  Loader2,
  RotateCcw,
  Settings2,
  X,
} from "lucide-react";
import type { BackupCopy, BackupOverview, BackupRunInfo } from "@/lib/backups/service";
import type { BackupFrequency, BackupProvider } from "@/lib/backups/schemas";

const PROVIDER_LABEL: Record<BackupProvider, string> = {
  r2: "Cloudflare R2",
  s3: "Amazon S3",
  s3compat: "S3 compatible",
};

const FREQ_LABEL: Record<BackupFrequency, string> = {
  hourly: "Cada hora",
  "6h": "Cada 6 horas",
  "12h": "Cada 12 horas",
  daily: "Diaria",
  "3d": "Cada 3 días",
  weekly: "Semanal",
  monthly: "Mensual",
};

/** Frecuencias que corren a una hora fija del día (muestran el selector de hora). */
const DAY_FREQS: BackupFrequency[] = ["daily", "3d", "weekly", "monthly"];

const KIND_LABEL: Record<string, string> = {
  auto: "Automática",
  manual: "Manual",
  restore: "Restauración",
};

const fmtDateTime = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString("es-ES", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type Notice = { ok: boolean; text: string } | null;

export function BackupsManager({
  initialOverview,
  initialRuns,
}: {
  initialOverview: BackupOverview;
  initialRuns: BackupRunInfo[];
}) {
  const [overview, setOverview] = useState(initialOverview);
  const [runs, setRuns] = useState(initialRuns);

  // ── Formulario de integración + configuración ──
  const [provider, setProvider] = useState<BackupProvider>(
    initialOverview.provider?.provider ?? "r2",
  );
  const [endpoint, setEndpoint] = useState(initialOverview.provider?.endpoint ?? "");
  const [accessKeyId, setAccessKeyId] = useState(initialOverview.provider?.accessKeyId ?? "");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState(initialOverview.provider?.bucket ?? "");
  const [frequency, setFrequency] = useState<BackupFrequency>(initialOverview.frequency);
  const [dailyTime, setDailyTime] = useState(initialOverview.dailyTime);

  const [busy, setBusy] = useState<"save" | "test" | "run" | "download" | "restore" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    const [ovRes, runsRes] = await Promise.all([
      fetch("/api/admin/backups"),
      fetch("/api/admin/backups/runs"),
    ]);
    if (ovRes.ok) {
      const data = (await ovRes.json()) as { overview: BackupOverview };
      setOverview(data.overview);
    }
    if (runsRes.ok) {
      const data = (await runsRes.json()) as { runs: BackupRunInfo[] };
      setRuns(data.runs);
    }
  }, []);

  async function save() {
    setBusy("save");
    setNotice(null);
    const res = await fetch("/api/admin/backups", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        endpoint: endpoint.trim(),
        accessKeyId: accessKeyId.trim(),
        // Solo enviamos el secret si lo han escrito (no pisar el guardado).
        secretAccessKey: secretAccessKey.trim(),
        bucket: bucket.trim(),
        frequency,
        dailyTime,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setNotice({ ok: false, text: data.error ?? "No se pudo guardar la configuración." });
      return;
    }
    setSecretAccessKey("");
    setNotice({ ok: true, text: "Configuración de copias guardada." });
    await refresh();
  }

  async function testConn() {
    setBusy("test");
    setNotice(null);
    const res = await fetch("/api/admin/backups/test", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    setBusy(null);
    setNotice({ ok: !!data.ok, text: data.message ?? "Fallo al probar la conexión." });
  }

  async function runNow() {
    setBusy("run");
    setNotice(null);
    const res = await fetch("/api/admin/backups/run", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      run?: BackupRunInfo;
      error?: string;
    };
    setBusy(null);
    if (!res.ok || !data.run) {
      setNotice({ ok: false, text: data.error ?? "No se pudo hacer la copia." });
    } else if (data.run.status === "ok") {
      setNotice({ ok: true, text: `Copia subida (${fmtSize(data.run.sizeBytes)}).` });
    } else {
      setNotice({ ok: false, text: `La copia falló: ${data.run.error ?? "error desconocido"}` });
    }
    await refresh();
  }

  async function downloadLatest() {
    setBusy("download");
    setNotice(null);
    try {
      const res = await fetch("/api/admin/backups/download");
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setNotice({ ok: false, text: data.error ?? "No se pudo descargar la copia." });
        return;
      }
      const blob = await res.blob();
      const stamp =
        overview.lastOk?.objectKey?.replace("spaider/", "").replace(".enc", "") ?? "ultima.dump";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `spaider-${stamp}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  }

  // ── Restaurar (doble confirmación) ──
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoreStep, setRestoreStep] = useState<1 | 2>(1);
  const [restoreKey, setRestoreKey] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [copies, setCopies] = useState<BackupCopy[] | null>(null);

  async function openRestore() {
    setRestoreKey(null);
    setRestoreStep(1);
    setConfirmText("");
    setCopies(null);
    setRestoreOpen(true);
    const res = await fetch("/api/admin/backups/copies");
    if (res.ok) {
      const data = (await res.json()) as { copies: BackupCopy[] };
      setCopies(data.copies);
    } else {
      setCopies([]);
    }
  }

  async function doRestore() {
    if (!restoreKey) return;
    setBusy("restore");
    const res = await fetch("/api/admin/backups/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: restoreKey, confirm: confirmText.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      run?: BackupRunInfo;
      error?: string;
    };
    setBusy(null);
    setRestoreOpen(false);
    if (!res.ok || !data.run) {
      setNotice({ ok: false, text: data.error ?? "No se pudo restaurar." });
    } else if (data.run.status === "ok") {
      setNotice({
        ok: true,
        text: "Restauración completada. Recarga la página para ver los datos restaurados.",
      });
    } else {
      setNotice({
        ok: false,
        text: `La restauración falló: ${data.run.error ?? "error desconocido"}`,
      });
    }
    await refresh();
  }

  const lastRun = overview.lastRun;
  const lastFailed = lastRun?.status === "error";

  return (
    <div className="flex flex-col gap-6">
      {/* Aviso llamativo si la última copia falló */}
      {lastFailed && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              La última copia de seguridad falló
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtDateTime(lastRun?.startedAt)} — {lastRun?.error ?? "motivo desconocido"}
            </p>
          </div>
        </div>
      )}

      {notice && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            notice.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {notice.ok ? <Check className="h-4 w-4 shrink-0" /> : <X className="h-4 w-4 shrink-0" />}
          {notice.text}
        </div>
      )}

      {/* Estado (siempre visible) */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-foreground" />
          <h2 className="text-base font-semibold">Estado</h2>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Última copia</p>
            {lastRun ? (
              <p className={lastFailed ? "text-destructive" : ""}>
                {fmtDateTime(lastRun.startedAt)} · {fmtSize(lastRun.sizeBytes)} ·{" "}
                {lastRun.status === "ok" ? "Correcta" : `Fallo: ${lastRun.error ?? "—"}`}
              </p>
            ) : (
              <p className="text-muted-foreground">Todavía no hay copias</p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Próxima programada</p>
            <p>
              {overview.configured
                ? fmtDateTime(overview.nextRunAt)
                : "Sin programar (configura la integración)"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Frecuencia</p>
            <p>
              {FREQ_LABEL[overview.frequency]}
              {DAY_FREQS.includes(overview.frequency) ? ` a las ${overview.dailyTime}` : ""}
            </p>
          </div>
        </div>
      </section>

      {/* Integración (proveedor S3) */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <CloudUpload className="h-5 w-5 text-foreground" />
          <div>
            <h2 className="text-base font-semibold">
              Integración{" "}
              {overview.provider?.secretConfigured && (
                <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium">
                  Configurada
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">
              Las copias se cifran antes de subir; el proveedor solo ve un blob. La Secret Access
              Key se guarda cifrada y no se vuelve a mostrar.
            </p>
          </div>
        </div>
        <div className="flex max-w-[260px] flex-col gap-1">
          <Label htmlFor="bk-provider">Proveedor</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as BackupProvider)}>
            <SelectTrigger id="bk-provider" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABEL) as BackupProvider[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-endpoint">Endpoint URL</Label>
            <Input
              id="bk-endpoint"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://<cuenta>.r2.cloudflarestorage.com"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-bucket">Bucket</Label>
            <Input
              id="bk-bucket"
              value={bucket}
              onChange={(e) => setBucket(e.target.value)}
              placeholder="spaider-backups"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-access">Access Key ID</Label>
            <Input
              id="bk-access"
              value={accessKeyId}
              onChange={(e) => setAccessKeyId(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bk-secret">Secret Access Key</Label>
            <Input
              id="bk-secret"
              type="password"
              value={secretAccessKey}
              onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder={
                overview.provider?.secretConfigured
                  ? "•••••••• (guardada — deja vacío para no cambiarla)"
                  : ""
              }
              autoComplete="new-password"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={testConn}
            disabled={busy !== null || !overview.configured}
            title={overview.configured ? undefined : "Guarda primero la configuración"}
          >
            {busy === "test" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Probar conexión
          </Button>
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </section>

      {/* Configuración de frecuencia */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-foreground" />
          <div>
            <h2 className="text-base font-semibold">Configuración</h2>
            <p className="text-xs text-muted-foreground">
              Retención automática: con copia diaria se conservan 7 diarias + 4 semanales; con más
              frecuencia, además las últimas 24-48 copias. Lo demás se borra solo del bucket.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex w-[200px] flex-col gap-1">
            <Label htmlFor="bk-freq">Frecuencia</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as BackupFrequency)}>
              <SelectTrigger id="bk-freq" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FREQ_LABEL) as BackupFrequency[]).map((f) => (
                  <SelectItem key={f} value={f}>
                    {FREQ_LABEL[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {DAY_FREQS.includes(frequency) && (
            <div className="flex w-[160px] flex-col gap-1">
              <Label htmlFor="bk-time">Hora de la copia diaria</Label>
              <Input
                id="bk-time"
                type="time"
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
              />
            </div>
          )}
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </section>

      {/* Acciones */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <DatabaseBackup className="h-5 w-5 text-foreground" />
          <h2 className="text-base font-semibold">Acciones</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runNow} disabled={busy !== null || !overview.configured}>
            {busy === "run" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <DatabaseBackup className="mr-2 h-4 w-4" />
            )}
            {busy === "run" ? "Haciendo copia…" : "Hacer copia ahora"}
          </Button>
          <Button
            variant="outline"
            onClick={downloadLatest}
            disabled={busy !== null || !overview.lastOk}
          >
            {busy === "download" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            {busy === "download" ? "Descargando…" : "Descargar última copia"}
          </Button>
          <Button
            variant="destructive"
            onClick={openRestore}
            disabled={busy !== null || !overview.configured}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Restaurar…
          </Button>
        </div>
      </section>

      {/* Historial de intentos */}
      <section className="glass-card flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <History className="h-5 w-5 text-foreground" />
          <h2 className="text-base font-semibold">Historial</h2>
        </div>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin intentos registrados todavía.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Fecha</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Resultado</th>
                  <th className="py-2 pr-3 text-right font-medium">Tamaño</th>
                  <th className="py-2 text-right font-medium">Duración</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border/50 last:border-0">
                    <td className="py-2 pr-3">{fmtDateTime(r.startedAt)}</td>
                    <td className="py-2 pr-3">{KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td
                      className={`py-2 pr-3 ${r.status === "ok" ? "" : "text-destructive"}`}
                      title={r.error ?? undefined}
                    >
                      {r.status === "ok" ? "Correcta" : `Fallo: ${(r.error ?? "").slice(0, 80)}`}
                    </td>
                    <td className="py-2 pr-3 text-right">{fmtSize(r.sizeBytes)}</td>
                    <td className="py-2 text-right">
                      {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)} s` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal de restauración con doble confirmación */}
      <Dialog open={restoreOpen} onOpenChange={setRestoreOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {restoreStep === 1 ? "Restaurar una copia" : "Confirmar restauración"}
            </DialogTitle>
          </DialogHeader>
          {restoreStep === 1 ? (
            <>
              <p className="text-sm text-muted-foreground">
                Elige la copia que quieres restaurar.
              </p>
              {copies === null ? (
                <p className="text-sm text-muted-foreground">Cargando copias…</p>
              ) : copies.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay copias en el bucket.</p>
              ) : (
                <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
                  {copies.map((c) => (
                    <label
                      key={c.key}
                      className="flex cursor-pointer items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name="bk-copy"
                        checked={restoreKey === c.key}
                        onChange={() => setRestoreKey(c.key)}
                      />
                      <span className="font-mono text-xs">
                        {c.key.replace("spaider/", "").replace(".dump.enc", "")}
                      </span>
                      <span className="text-xs text-muted-foreground">{fmtSize(c.size)}</span>
                    </label>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  disabled={!restoreKey}
                  onClick={() => setRestoreStep(2)}
                >
                  Continuar
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <p className="text-sm">
                Vas a restaurar{" "}
                <b className="font-mono">{restoreKey?.replace("spaider/", "")}</b>.
              </p>
              <p className="text-sm text-destructive">
                <b>Esta acción PISA los datos actuales de spAIder.</b> Todo lo creado o cambiado
                después de esa copia se perderá. No se puede deshacer.
              </p>
              <div className="flex flex-col gap-1">
                <Label htmlFor="bk-confirm">Escribe RESTAURAR para confirmar</Label>
                <Input
                  id="bk-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setRestoreStep(1)}
                  disabled={busy === "restore"}
                >
                  Atrás
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    confirmText.trim() !== "RESTAURAR" || !restoreKey || busy === "restore"
                  }
                  onClick={doRestore}
                >
                  {busy === "restore" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {busy === "restore" ? "Restaurando…" : "Restaurar y pisar datos"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
