"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Play,
  Plus,
  Trash2,
  Pencil,
  Pause,
  PlayCircle,
  X,
  RefreshCw,
  Sparkles,
  History,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  PRESETS,
  WEEKDAYS,
  EVERY_N_OPTIONS,
  buildCron,
  parseCron,
  humanizeCron,
  type SchedulePresetId,
} from "@/lib/automations/schedule";
import {
  PLATFORM_LIST,
  PLATFORMS,
  type Platform,
  type FilterValue,
} from "@/lib/apify/platforms";
import {
  ApifyFiltersForm,
  defaultFiltersFor,
} from "@/components/research/apify-filters-form";
import { ApifyDynamicForm } from "@/components/research/apify-dynamic-form";

type Automation = {
  id: string;
  name: string;
  triggerType: string;
  cron: string | null;
  targetType: string;
  paramsJson: string | null;
  isActive: boolean;
  lastRunAt: string | null;
  runsCount: number;
};

type Source = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  platform?: string | null;
  configJson?: string | null;
};

/**
 * Tres caminos posibles en el formulario:
 *
 *   APIFY        → automatización que usa Apify (scraper de redes). El form
 *                  pide plataforma + actor + criterios; al guardar, el cliente
 *                  crea/actualiza una Source APIFY por debajo y enlaza la
 *                  automatización a ella. El usuario nunca tiene que pensar
 *                  en "fuentes" — sólo en qué quiere scrapear.
 *
 *   CLAUDE_CODE  → tipo obsoleto: se lista como "obsoleta" y solo admite
 *                  pausar/borrar. No se ofrece al crear.
 *
 *   LEGACY_SOURCE → modo de compatibilidad para automatizaciones antiguas
 *                  que refrescan una Source RSS/URL/YOUTUBE existente.
 *                  Sólo se ve al EDITAR una de ese tipo; no se ofrece para
 *                  crear nuevas (el usuario ya puede refrescar la fuente
 *                  manualmente desde /investigacion/fuentes).
 */
type AutomationKind = "APIFY" | "AI_RESEARCH" | "CLAUDE_CODE" | "LEGACY_SOURCE";

/**
 * Etiqueta humana para cada tipo de automatización. APIFY y AI_RESEARCH se
 * ofrecen al crear; CLAUDE_CODE (obsoleta) y LEGACY_SOURCE solo en el listado.
 */
const KIND_LABEL: Record<AutomationKind, { label: string; icon: typeof RefreshCw; help: string }> = {
  APIFY: {
    label: "Apify",
    icon: Sparkles,
    help: "Scrapea redes sociales: Instagram, TikTok, YouTube, Facebook, LinkedIn, X.",
  },
  AI_RESEARCH: {
    label: "Investigación IA",
    icon: Sparkles,
    help: "Busca en la web sobre un brief con tu proveedor LLM y crea hallazgos, de forma periódica.",
  },
  CLAUDE_CODE: {
    label: "Obsoleta (Claude Code)",
    icon: RefreshCw,
    help: "Tipo retirado al pasar a 100% API. Solo se puede pausar o borrar.",
  },
  LEGACY_SOURCE: {
    label: "Refrescar fuente existente",
    icon: RefreshCw,
    help: "Modo legado: refresca una fuente RSS/URL/YouTube ya guardada.",
  },
};

type FormState = {
  kind: AutomationKind;
  name: string;
  triggerType: "MANUAL" | "SCHEDULED";
  // Schedule
  preset: SchedulePresetId;
  everyN: number;
  time: string;
  weekday: number;
  rawCron: string;
  // Apify path
  apifyMode: "platform" | "actor";
  platform: Platform;
  query: string;
  maxItems: number;
  actorId: string;
  filters: Record<string, FilterValue>;
  // Apify modo actor (dinámico): actor elegido + input construido del schema.
  dynActorId: string;
  dynInput: Record<string, unknown>;
  // Claude Code path
  brief: string;
  // Bookkeeping: si estamos editando, guardamos el sourceId enlazado para
  // que al guardar podamos actualizarlo en vez de crear otro.
  linkedSourceId: string | null;
  // Sólo para LEGACY_SOURCE: id de la fuente RSS/URL/YouTube preexistente.
  legacySourceId: string;
};

const emptyForm: FormState = {
  kind: "APIFY",
  name: "",
  triggerType: "SCHEDULED",
  preset: "daily",
  everyN: 6,
  time: "09:00",
  weekday: 1,
  rawCron: "",
  apifyMode: "platform",
  platform: "INSTAGRAM",
  query: "",
  maxItems: 30,
  actorId: "",
  filters: defaultFiltersFor("INSTAGRAM"),
  dynActorId: "",
  dynInput: {},
  brief: "",
  linkedSourceId: null,
  legacySourceId: "",
};

/** Hora actual (HH:MM) en una zona IANA, para que el usuario compruebe la
 * zona horaria de los crons de un vistazo. Devuelve "" si la zona no es válida. */
function nowInZone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(new Date());
  } catch {
    return "";
  }
}

type RunRow = {
  id: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  logs: string | null;
};

/** Fecha+hora (con segundos) de un ISO en una zona IANA, para cotejar con el cron. */
function fmtInZone(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("es-ES");
  }
}

/** Duración legible entre dos ISO (o "en curso" si no ha terminado). */
function fmtDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "en curso";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/**
 * Detecta qué tipo de automatización es a partir de los datos guardados,
 * para que el formulario abra el modo correcto al editar.
 *
 * Compatibilidad: targetType=RESEARCH_CLI se detecta como CLAUDE_CODE; con
 * targetType=SOURCE el tipo sale de `source.type` (incluido "CLAUDE_CODE").
 */
function detectKind(a: Automation, source: Source | null): AutomationKind {
  if (a.targetType === "RESEARCH_CLI") return "CLAUDE_CODE";
  if (a.targetType === "SOURCE") {
    if (source?.type === "APIFY") return "APIFY";
    if (source?.type === "AI_RESEARCH") return "AI_RESEARCH";
    if (source?.type === "CLAUDE_CODE") return "CLAUDE_CODE";
  }
  return "LEGACY_SOURCE";
}

function formFromAutomation(a: Automation, sources: Source[]): FormState {
  const sched = parseCron(a.cron);
  let linkedSourceId: string | null = null;
  let briefFromParams = "";
  if (a.paramsJson) {
    try {
      const p = JSON.parse(a.paramsJson);
      if (typeof p.sourceId === "string") linkedSourceId = p.sourceId;
      // brief en paramsJson sólo en automatizaciones legacy (RESEARCH_CLI).
      if (typeof p.brief === "string") briefFromParams = p.brief;
    } catch {
      /* ignore */
    }
  }
  const source = linkedSourceId
    ? sources.find((s) => s.id === linkedSourceId) ?? null
    : null;
  const kind = detectKind(a, source);

  // Si es APIFY, rellenamos el form con los criterios reales de la Source.
  let platform: Platform = "INSTAGRAM";
  let query = "";
  let maxItems = 30;
  let actorId = "";
  let apifyMode: "platform" | "actor" = "platform";
  let dynActorId = "";
  let dynInput: Record<string, unknown> = {};
  let filters: Record<string, FilterValue> = defaultFiltersFor("INSTAGRAM");
  let brief = briefFromParams;
  if (kind === "APIFY" && source) {
    if (source.platform) platform = source.platform as Platform;
    filters = defaultFiltersFor(platform);
    if (source.configJson) {
      try {
        const cfg = JSON.parse(source.configJson) as {
          query?: string;
          maxItems?: number;
          actorId?: string;
          filters?: Record<string, FilterValue>;
          dynamic?: boolean;
          input?: Record<string, unknown>;
        };
        if (cfg.dynamic && typeof cfg.actorId === "string") {
          apifyMode = "actor";
          dynActorId = cfg.actorId;
          dynInput = cfg.input ?? {};
          if (typeof cfg.maxItems === "number") maxItems = cfg.maxItems;
        }
        if (typeof cfg.query === "string") query = cfg.query;
        if (typeof cfg.maxItems === "number") maxItems = cfg.maxItems;
        if (typeof cfg.actorId === "string" && !cfg.dynamic) actorId = cfg.actorId;
        if (cfg.filters && typeof cfg.filters === "object") {
          filters = { ...filters, ...cfg.filters };
        }
      } catch {
        /* ignore */
      }
    }
  }
  // Si es CLAUDE_CODE moderno (source.type=CLAUDE_CODE), el brief vive en
  // source.configJson en lugar de paramsJson — lo leemos de ahí.
  if (kind === "CLAUDE_CODE" && source?.type === "CLAUDE_CODE" && source.configJson) {
    try {
      const cfg = JSON.parse(source.configJson) as { brief?: string };
      if (typeof cfg.brief === "string") brief = cfg.brief;
    } catch {
      /* ignore */
    }
  }
  // Investigación IA: el brief vive en source.configJson.
  if (kind === "AI_RESEARCH" && source?.type === "AI_RESEARCH" && source.configJson) {
    try {
      const cfg = JSON.parse(source.configJson) as { brief?: string };
      if (typeof cfg.brief === "string") brief = cfg.brief;
    } catch {
      /* ignore */
    }
  }

  return {
    kind,
    name: a.name,
    triggerType: (a.triggerType as "MANUAL" | "SCHEDULED") ?? "MANUAL",
    preset: sched.preset,
    everyN: sched.everyN ?? 6,
    time: sched.time ?? "09:00",
    weekday: sched.weekday ?? 1,
    rawCron: sched.rawCron ?? "",
    apifyMode,
    platform,
    query,
    maxItems,
    actorId,
    filters,
    dynActorId,
    dynInput,
    brief,
    linkedSourceId,
    legacySourceId: kind === "LEGACY_SOURCE" ? (linkedSourceId ?? "") : "",
  };
}

export function AutomationsPanel({
  initial,
  sources,
  cronTz,
}: {
  initial: Automation[];
  sources: Source[];
  cronTz: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null | "new">(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function openNew() {
    setEditing("new");
    setForm({ ...emptyForm });
    setError(null);
    setMessage(null);
  }
  function openEdit(a: Automation) {
    setEditing(a.id);
    setForm(formFromAutomation(a, sources));
    setError(null);
    setMessage(null);
  }
  function closeForm() {
    setEditing(null);
    setError(null);
  }

  /**
   * Crea o actualiza la Source enlazada según el `kind`, devolviendo su id.
   * Para APIFY: empaqueta query/maxItems/actorId/filters en configJson.
   * Para LEGACY_SOURCE: no toca nada, devuelve el id ya elegido.
   */
  async function persistLinkedSource(): Promise<string | null> {
    if (form.kind === "LEGACY_SOURCE") {
      if (!form.legacySourceId) {
        setError("Elige una fuente existente para refrescar.");
        return null;
      }
      return form.legacySourceId;
    }

    if (form.kind === "APIFY") {
      const isDynamic = form.apifyMode === "actor";
      if (isDynamic && !form.dynActorId.trim()) {
        setError("Elige (o escribe) el actor de Apify y carga sus campos.");
        return null;
      }
      if (!isDynamic && !form.query.trim()) {
        setError("Escribe la query (hashtags, keywords o URLs) que va a buscar el actor.");
        return null;
      }
      const configJson = isDynamic
        ? JSON.stringify({
            dynamic: true,
            actorId: form.dynActorId.trim(),
            input: form.dynInput,
            maxItems: form.maxItems,
          })
        : JSON.stringify({
            query: form.query.trim(),
            maxItems: form.maxItems,
            ...(form.actorId.trim() ? { actorId: form.actorId.trim() } : {}),
            filters: form.filters,
          });
      const sourceBody = {
        name:
          form.name.trim() ||
          (isDynamic ? `Apify · ${form.dynActorId}` : `Automatización Apify · ${form.platform}`),
        type: "APIFY" as const,
        // En modo actor no hay "platform"; guardamos CUSTOM para no romper el enum.
        platform: isDynamic ? undefined : form.platform,
        configJson,
        isActive: true,
      };
      // Si ya había una Source enlazada (edit), la actualizamos vía PUT
      // (mantiene los findings históricos). Si no, creamos una nueva.
      if (form.linkedSourceId) {
        const r = await fetch(`/api/sources/${form.linkedSourceId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sourceBody),
        });
        if (!r.ok) {
          setError("No se pudo actualizar la fuente Apify enlazada.");
          return null;
        }
        return form.linkedSourceId;
      }
      const r = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sourceBody),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.source?.id) {
        setError(data.error ?? "No se pudo crear la fuente Apify.");
        return null;
      }
      return data.source.id as string;
    }

    if (form.kind === "AI_RESEARCH") {
      if (form.brief.trim().length < 8) {
        setError("Escribe un brief un poco más concreto para la investigación.");
        return null;
      }
      const sourceBody = {
        name: form.name.trim() || `Investigación IA · ${form.brief.trim().slice(0, 40)}`,
        type: "AI_RESEARCH" as const,
        configJson: JSON.stringify({ brief: form.brief.trim() }),
        isActive: true,
      };
      if (form.linkedSourceId) {
        const r = await fetch(`/api/sources/${form.linkedSourceId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sourceBody),
        });
        if (!r.ok) {
          setError("No se pudo actualizar la fuente de Investigación IA.");
          return null;
        }
        return form.linkedSourceId;
      }
      const r = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sourceBody),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.source?.id) {
        setError(data.error ?? "No se pudo crear la fuente de Investigación IA.");
        return null;
      }
      return data.source.id as string;
    }

    // Solo APIFY, AI_RESEARCH y LEGACY_SOURCE son creables; el resto no llega aquí.
    setError("Tipo de automatización no soportado.");
    return null;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Pon un nombre a la automatización.");
      return;
    }

    const cron =
      form.triggerType === "SCHEDULED"
        ? buildCron({
            preset: form.preset,
            everyN: form.everyN,
            time: form.time,
            weekday: form.weekday,
            rawCron: form.rawCron,
          })
        : null;
    if (form.triggerType === "SCHEDULED" && !cron) {
      setError("Configura una frecuencia válida.");
      return;
    }

    // Paso 1: crear/actualizar la Source enlazada según el kind.
    const sourceId = await persistLinkedSource();
    if (!sourceId) return;

    // Paso 2: todos los kinds disparan `runSourceFetch` sobre la Source.
    // El propio `runSourceFetch` se encarga del comportamiento correcto
    // según `source.type` (APIFY → actor, RSS/URL → fetcher web). Así el
    // runner de cron no tiene que conocer estos detalles.
    const targetType = "SOURCE";
    const params = { sourceId };

    const body = {
      name: form.name.trim(),
      triggerType: form.triggerType,
      cron,
      targetType,
      paramsJson: JSON.stringify(params),
    };

    const isNew = editing === "new";
    const url = isNew ? "/api/automations" : `/api/automations/${editing}`;
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando la automatización.");
      return;
    }
    closeForm();
    startTransition(() => router.refresh());
  }

  async function run(id: string, dryRun = false) {
    setRunningId(id);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/automations/${id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    setRunningId(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "Error ejecutando");
      return;
    }
    setMessage(`[${data.status}] ${data.logs}`);
    startTransition(() => router.refresh());
  }

  async function toggleActive(a: Automation) {
    const res = await fetch(`/api/automations/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !a.isActive }),
    });
    if (!res.ok) return;
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar esta automatización?")) return;
    await fetch(`/api/automations/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  // ── Historial de ejecuciones (para comprobar las horas del cron) ──────────
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runsData, setRunsData] = useState<RunRow[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);

  async function toggleRuns(id: string) {
    if (runsFor === id) {
      setRunsFor(null);
      return;
    }
    setRunsFor(id);
    setRunsData([]);
    setRunsLoading(true);
    try {
      const res = await fetch(`/api/automations/${id}/runs`);
      const data = await res.json().catch(() => ({}));
      setRunsData(Array.isArray(data.runs) ? data.runs : []);
    } catch {
      setRunsData([]);
    } finally {
      setRunsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="display-md">Automatizaciones</h1>
          <p className="text-sm text-muted-foreground">
            Dispara tareas manualmente o en un horario programado. Requiere
            que la máquina de SpAIder esté encendida en el momento del cron.
          </p>
        </div>
        <Button onClick={openNew} className="gap-1.5">
          <Plus className="h-4 w-4" /> Nueva
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {message && (
        <pre className="glass-card overflow-auto p-3 text-xs">{message}</pre>
      )}

      {editing && (
        <form
          onSubmit={onSubmit}
          className="glass-card relative grid gap-4 p-5 md:grid-cols-2"
        >
          <button
            type="button"
            onClick={closeForm}
            aria-label="Cerrar"
            className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="md:col-span-2 flex items-center gap-2 text-sm font-semibold">
            <Pencil className="h-4 w-4 text-foreground" />
            {editing === "new"
              ? "Nueva automatización"
              : "Editar automatización"}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="au-name">Nombre</Label>
            <Input
              id="au-name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Ej. Refrescar Anthropic Blog"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="au-trigger">¿Cuándo se ejecuta?</Label>
            <Select
              value={form.triggerType}
              onValueChange={(v) =>
                setForm({ ...form, triggerType: v as FormState["triggerType"] })
              }
            >
              <SelectTrigger id="au-trigger" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">
                  Manualmente cuando pulse
                </SelectItem>
                <SelectItem value="SCHEDULED">
                  Programado (se repite solo)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.triggerType === "SCHEDULED" && (
            <div className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-border/40 bg-background/30 p-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="au-preset">Frecuencia</Label>
                <Select
                  value={form.preset}
                  onValueChange={(v) =>
                    setForm({ ...form, preset: v as SchedulePresetId })
                  }
                >
                  <SelectTrigger id="au-preset" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {PRESETS.find((p) => p.id === form.preset)?.hint}
                </p>
              </div>

              {form.preset === "every_n_hours" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="au-n">Cada N horas</Label>
                  <Select
                    value={String(form.everyN)}
                    onValueChange={(v) =>
                      setForm({ ...form, everyN: Number(v) })
                    }
                  >
                    <SelectTrigger id="au-n" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVERY_N_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          Cada {n} horas
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {(form.preset === "daily" ||
                form.preset === "weekdays" ||
                form.preset === "weekly") && (
                <div className="grid gap-3 md:grid-cols-2">
                  {form.preset === "weekly" && (
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="au-dow">Día de la semana</Label>
                      <Select
                        value={String(form.weekday)}
                        onValueChange={(v) =>
                          setForm({ ...form, weekday: Number(v) })
                        }
                      >
                        <SelectTrigger id="au-dow" className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEEKDAYS.map((d) => (
                            <SelectItem key={d.value} value={String(d.value)}>
                              {d.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="au-time">Hora</Label>
                    <Input
                      id="au-time"
                      type="time"
                      value={form.time}
                      onChange={(e) => setForm({ ...form, time: e.target.value })}
                    />
                  </div>
                </div>
              )}

              {form.preset === "custom" && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="au-cron">
                    Cron raw{" "}
                    <span className="text-[10px] font-normal text-muted-foreground">
                      5 campos: m h dom mon dow
                    </span>
                  </Label>
                  <Input
                    id="au-cron"
                    value={form.rawCron}
                    onChange={(e) =>
                      setForm({ ...form, rawCron: e.target.value })
                    }
                    placeholder="0 */6 * * *"
                    className="font-mono"
                  />
                </div>
              )}

              <p className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                🕓 Las horas se interpretan en <strong>{cronTz}</strong>
                {nowInZone(cronTz) && <> · ahora mismo allí son las {nowInZone(cronTz)}</>}.
                El servidor corre en UTC, pero la programación usa esta zona
                (ajusta el horario de verano automáticamente).
              </p>
            </div>
          )}

          {/* Selector de tipo · sólo se muestra LEGACY_SOURCE en modo edit
              cuando el automation existente lo requiera (no para crear nuevos). */}
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label>¿Con qué motor automatizar?</Label>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {(["APIFY", "AI_RESEARCH"] as const).map((k) => {
                const meta = KIND_LABEL[k];
                const Icon = meta.icon;
                const selected = form.kind === k;
                return (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setForm({ ...form, kind: k })}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
                      selected
                        ? "border-primary/60 bg-primary/[0.07]"
                        : "border-border/40 hover:border-border/70"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon
                        className={`h-4 w-4 ${selected ? "text-foreground" : "text-muted-foreground"}`}
                      />
                      <span className="text-sm font-semibold">{meta.label}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{meta.help}</p>
                  </button>
                );
              })}
            </div>
            {form.kind === "LEGACY_SOURCE" && (
              <p className="text-[11px] text-amber-500">
                Modo legado: esta automatización refresca una fuente existente.
                Puedes mantenerla o convertirla a Apify creando una nueva.
              </p>
            )}
          </div>

          {/* INVESTIGACIÓN IA: solo el brief; el proveedor se elige por defecto. */}
          {form.kind === "AI_RESEARCH" && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="au-brief">Brief de investigación</Label>
              <textarea
                id="au-brief"
                rows={4}
                value={form.brief}
                onChange={(e) => setForm({ ...form, brief: e.target.value })}
                placeholder={`Ej: Novedades de las últimas semanas sobre "IA aplicada a pymes". Prioriza casos con métricas.`}
                className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Cada ejecución busca en la web con tu proveedor LLM (el marcado
                por defecto en /admin/proveedores) y crea hallazgos nuevos,
                priorizando lo reciente.
              </p>
            </div>
          )}

          {/* APIFY: plataforma curada · o actor de tu cuenta con campos dinámicos */}
          {form.kind === "APIFY" && (
            <>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label>Modo Apify</Label>
                <div className="inline-flex overflow-hidden rounded-md border border-border/60 self-start">
                  {(["platform", "actor"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setForm({ ...form, apifyMode: m })}
                      className={`px-3 py-1.5 text-xs ${form.apifyMode === m ? "bg-card text-foreground" : "text-muted-foreground hover:bg-accent/40"}`}
                    >
                      {m === "platform" ? "Plataforma (curada)" : "Actor de Apify"}
                    </button>
                  ))}
                </div>
              </div>

              {form.apifyMode === "actor" && (
                <div className="md:col-span-2">
                  <ApifyDynamicForm
                    value={{ actorId: form.dynActorId, input: form.dynInput }}
                    onChange={(v) =>
                      setForm({ ...form, dynActorId: v.actorId, dynInput: v.input })
                    }
                  />
                  <div className="mt-3 flex flex-col gap-1.5">
                    <Label htmlFor="au-dyn-max">Máximo de items</Label>
                    <Input
                      id="au-dyn-max"
                      type="number"
                      value={form.maxItems}
                      onChange={(e) => setForm({ ...form, maxItems: Number(e.target.value) || 30 })}
                      className="w-32"
                    />
                  </div>
                </div>
              )}

              {form.apifyMode === "platform" && (
              <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="au-platform">Plataforma</Label>
                <Select
                  value={form.platform}
                  onValueChange={(v) => {
                    const next = v as Platform;
                    setForm({
                      ...form,
                      platform: next,
                      filters: defaultFiltersFor(next),
                    });
                  }}
                >
                  <SelectTrigger id="au-platform" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORM_LIST.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PLATFORMS[p].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="au-max">Máx items por ejecución</Label>
                <Input
                  id="au-max"
                  type="number"
                  min={1}
                  max={100}
                  value={form.maxItems}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxItems: Math.max(
                        1,
                        Math.min(100, Number(e.target.value) || 30),
                      ),
                    })
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="au-query">
                  Qué buscar{" "}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    {PLATFORMS[form.platform].queryHint}
                  </span>
                </Label>
                <Textarea
                  id="au-query"
                  rows={2}
                  value={form.query}
                  onChange={(e) => setForm({ ...form, query: e.target.value })}
                  placeholder={PLATFORMS[form.platform].queryHint}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="au-actor">
                  Actor ID{" "}
                  <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                    (opcional — vacío usa el actor por defecto)
                  </span>
                </Label>
                <Input
                  id="au-actor"
                  type="text"
                  value={form.actorId}
                  onChange={(e) => setForm({ ...form, actorId: e.target.value })}
                  placeholder={PLATFORMS[form.platform].defaultActorId}
                  className="font-mono text-xs"
                />
              </div>
              <div className="md:col-span-2">
                <ApifyFiltersForm
                  platform={form.platform}
                  value={form.filters}
                  onChange={(filters) => setForm({ ...form, filters })}
                />
              </div>
              </>
              )}
            </>
          )}

          {/* LEGACY: select de fuente existente (sólo edición de antiguas) */}
          {form.kind === "LEGACY_SOURCE" && (
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="au-legacy-src">Fuente a refrescar</Label>
              <Select
                value={form.legacySourceId}
                onValueChange={(v) => setForm({ ...form, legacySourceId: v })}
              >
                <SelectTrigger id="au-legacy-src" className="h-9">
                  <SelectValue placeholder="Elige una fuente" />
                </SelectTrigger>
                <SelectContent>
                  {sources
                    .filter((s) => s.type !== "MANUAL")
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id} disabled={!s.isActive}>
                        {s.name} · {s.type}
                        {!s.isActive ? " (inactiva)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={closeForm}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing === "new" ? "Crear" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Qué hace</th>
              <th className="px-3 py-2 text-left">Cuándo</th>
              <th className="px-3 py-2 text-left">Último run</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-8 text-center text-muted-foreground"
                >
                  Sin automatizaciones. Crea la primera con <strong>Nueva</strong>.
                </td>
              </tr>
            )}
            {initial.map((a) => {
              // Detectamos el "kind" para el listado igual que en el form
              // (Apify · obsoleta · Refresco legado) y pintamos el badge.
              let kindLabel = "Refrescar fuente";
              let TargetIcon: typeof Sparkles = RefreshCw;
              let obsolete = false;
              if (a.targetType === "RESEARCH_CLI") {
                kindLabel = KIND_LABEL.CLAUDE_CODE.label;
                TargetIcon = KIND_LABEL.CLAUDE_CODE.icon;
                obsolete = true;
              } else {
                let linkedSrc: Source | undefined;
                try {
                  const p = a.paramsJson ? JSON.parse(a.paramsJson) : null;
                  if (p && typeof p.sourceId === "string") {
                    linkedSrc = sources.find((s) => s.id === p.sourceId);
                  }
                } catch {
                  /* ignore */
                }
                if (linkedSrc?.type === "APIFY") {
                  kindLabel = KIND_LABEL.APIFY.label;
                  TargetIcon = KIND_LABEL.APIFY.icon;
                } else if (linkedSrc?.type === "AI_RESEARCH") {
                  kindLabel = KIND_LABEL.AI_RESEARCH.label;
                  TargetIcon = KIND_LABEL.AI_RESEARCH.icon;
                } else if (linkedSrc?.type === "CLAUDE_CODE") {
                  kindLabel = KIND_LABEL.CLAUDE_CODE.label;
                  TargetIcon = KIND_LABEL.CLAUDE_CODE.icon;
                  obsolete = true;
                }
              }
              return (
                <Fragment key={a.id}>
                <tr className="border-t border-border/40 align-top">
                  <td className="px-3 py-3 font-medium">{a.name}</td>
                  <td className="px-3 py-3">
                    <span className="inline-flex items-center gap-1.5 text-xs">
                      <TargetIcon className="h-3.5 w-3.5 text-foreground/80" />
                      {kindLabel}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {a.triggerType === "MANUAL" ? (
                      <Badge variant="outline">Manual</Badge>
                    ) : (
                      <span className="inline-flex flex-col">
                        <span className="font-medium">
                          {humanizeCron(a.cron)}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {a.cron}
                        </span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted-foreground">
                    {a.lastRunAt
                      ? new Date(a.lastRunAt).toLocaleString("es-ES")
                      : "—"}
                    <br />
                    <span className="text-[10px]">{a.runsCount} runs</span>
                  </td>
                  <td className="px-3 py-3">
                    <button
                      type="button"
                      onClick={() => toggleActive(a)}
                      className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-background/40 px-2 py-0.5 text-[10px] uppercase tracking-widest transition hover:border-primary/40"
                    >
                      {a.isActive ? (
                        <>
                          <PlayCircle className="h-3 w-3 text-foreground" /> Activa
                        </>
                      ) : (
                        <>
                          <Pause className="h-3 w-3 text-muted-foreground" /> Pausada
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      {/* Obsoletas: ni ejecutar ni editar */}
                      {!obsolete && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => run(a.id, true)}
                            disabled={runningId === a.id}
                          >
                            Dry-run
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => run(a.id, false)}
                            disabled={runningId === a.id}
                            className="gap-1.5"
                          >
                            {runningId === a.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                            Ejecutar
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(a)}
                            aria-label="Editar"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleRuns(a.id)}
                        aria-label="Ver ejecuciones"
                        title="Ver el historial de ejecuciones (horas)"
                        className={runsFor === a.id ? "bg-accent/50" : ""}
                      >
                        <History className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(a.id)}
                        aria-label="Eliminar"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {runsFor === a.id && (
                  <tr className="border-t border-border/40 bg-muted/20">
                    <td colSpan={6} className="px-3 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                          Ejecuciones · horas en {cronTz}
                        </p>
                        <button
                          type="button"
                          onClick={() => toggleRuns(a.id)}
                          className="text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Cerrar
                        </button>
                      </div>
                      {runsLoading ? (
                        <p className="py-3 text-xs text-muted-foreground">
                          <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                          Cargando…
                        </p>
                      ) : runsData.length === 0 ? (
                        <p className="py-3 text-xs text-muted-foreground">
                          Aún no se ha ejecutado ninguna vez. Si es programada,
                          confirma que la máquina estaba encendida a la hora del cron.
                        </p>
                      ) : (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead className="text-[10px] uppercase tracking-widest text-muted-foreground">
                              <tr>
                                <th className="px-2 py-1 text-left">Inicio</th>
                                <th className="px-2 py-1 text-left">Estado</th>
                                <th className="px-2 py-1 text-left">Duración</th>
                                <th className="px-2 py-1 text-left">Log</th>
                              </tr>
                            </thead>
                            <tbody>
                              {runsData.map((r) => (
                                <tr key={r.id} className="border-t border-border/30 align-top">
                                  <td className="px-2 py-1.5 font-mono tabular-nums">
                                    {fmtInZone(r.startedAt, cronTz)}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {r.status === "SUCCESS" ? (
                                      <span className="inline-flex items-center gap-1 text-ok">
                                        <CheckCircle2 className="h-3 w-3" /> OK
                                      </span>
                                    ) : r.status === "ERROR" ? (
                                      <span className="inline-flex items-center gap-1 text-destructive">
                                        <XCircle className="h-3 w-3" /> Error
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                                        <Loader2 className="h-3 w-3 animate-spin" /> {r.status}
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-muted-foreground">
                                    {fmtDuration(r.startedAt, r.finishedAt)}
                                  </td>
                                  <td className="px-2 py-1.5">
                                    {r.logs ? (
                                      <details>
                                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                          ver
                                        </summary>
                                        <pre className="mt-1 max-w-xl whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
                                          {r.logs}
                                        </pre>
                                      </details>
                                    ) : (
                                      <span className="text-muted-foreground/50">—</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
