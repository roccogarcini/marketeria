"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw } from "lucide-react";

type ActorRef = { id: string; name: string; title: string };
type Field = {
  key: string;
  title: string;
  type: "string" | "integer" | "number" | "boolean" | "array" | "object";
  editor?: string;
  description?: string;
  default?: unknown;
  prefill?: unknown;
  enumValues?: string[];
  enumTitles?: string[];
  required: boolean;
};

export type ApifyDynamicValue = {
  actorId: string;
  input: Record<string, unknown>;
};

/**
 * Selector de actor de Apify + formulario generado desde su input schema.
 * Notifica al padre (onChange) el actorId + el objeto de input construido.
 */
export function ApifyDynamicForm({
  value,
  onChange,
}: {
  value: ApifyDynamicValue;
  onChange: (v: ApifyDynamicValue) => void;
}) {
  const [actors, setActors] = useState<ActorRef[]>([]);
  const [loadingActors, setLoadingActors] = useState(false);
  const [actorId, setActorId] = useState(value.actorId ?? "");
  const [fields, setFields] = useState<Field[]>([]);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(value.input ?? {}).map(([k, v]) => [
        k,
        Array.isArray(v) ? (v as unknown[]).join("\n") : typeof v === "object" ? JSON.stringify(v) : String(v),
      ]),
    ),
  );
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Carga los actores de la cuenta al montar.
  useEffect(() => {
    setLoadingActors(true);
    fetch("/api/apify/actors")
      .then((r) => r.json())
      .then((d) => setActors(d.actors ?? []))
      .catch(() => setActors([]))
      .finally(() => setLoadingActors(false));
  }, []);

  // Reconstruye el objeto de input tipado y lo sube al padre.
  function emit(nextActor: string, nextFields: Field[], nextValues: Record<string, string>) {
    const input: Record<string, unknown> = {};
    for (const f of nextFields) {
      const raw = nextValues[f.key];
      if (raw === undefined || raw === "") continue;
      if (f.type === "integer" || f.type === "number") input[f.key] = Number(raw);
      else if (f.type === "boolean") input[f.key] = raw === "true";
      else if (f.type === "array")
        input[f.key] = raw.split("\n").map((s) => s.trim()).filter(Boolean);
      else if (f.type === "object") {
        try {
          input[f.key] = JSON.parse(raw);
        } catch {
          /* objeto inválido → se omite */
        }
      } else input[f.key] = raw;
    }
    onChange({ actorId: nextActor, input });
  }

  async function loadSchema(id: string) {
    if (!id.trim()) return;
    setLoadingSchema(true);
    setSchemaError(null);
    setFields([]);
    try {
      const r = await fetch(`/api/apify/actor-schema?actorId=${encodeURIComponent(id.trim())}`);
      const d = await r.json();
      if (!r.ok) {
        setSchemaError(d.error ?? "No se pudo leer el esquema del actor.");
        return;
      }
      const fs: Field[] = d.schema?.fields ?? [];
      setFields(fs);
      // Prefill/default en los valores si el usuario no tenía ya algo.
      setValues((prev) => {
        const next = { ...prev };
        for (const f of fs) {
          if (next[f.key] === undefined) {
            const dv = f.prefill ?? f.default;
            if (dv !== undefined && dv !== null) {
              next[f.key] = Array.isArray(dv) ? (dv as unknown[]).join("\n") : String(dv);
            }
          }
        }
        emit(id.trim(), fs, next);
        return next;
      });
    } catch {
      setSchemaError("Error de red obteniendo el esquema.");
    } finally {
      setLoadingSchema(false);
    }
  }

  function setFieldValue(key: string, v: string) {
    setValues((prev) => {
      const next = { ...prev, [key]: v };
      emit(actorId, fields, next);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="apf-actor">Actor de Apify</Label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            id="apf-actor"
            value={actors.some((a) => a.id === actorId) ? actorId : ""}
            onChange={(e) => {
              setActorId(e.target.value);
              loadSchema(e.target.value);
            }}
            className="h-9 min-w-56 flex-1 rounded-md border border-input bg-transparent px-3 text-sm"
          >
            <option value="">
              {loadingActors ? "Cargando actores…" : "Elige un actor de tu cuenta…"}
            </option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title} ({a.id})
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="o escribe un id del store: apify~instagram-hashtag-scraper"
            className="text-xs"
          />
          <button
            type="button"
            onClick={() => loadSchema(actorId)}
            disabled={loadingSchema || !actorId.trim()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-input px-3 text-xs hover:bg-accent/40 disabled:opacity-50"
          >
            {loadingSchema ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Cargar campos
          </button>
        </div>
      </div>

      {schemaError && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {schemaError}
        </p>
      )}

      {fields.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-border/50 bg-background/30 p-3">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label htmlFor={`apf-${f.key}`} className="flex items-center gap-1.5 text-xs">
                {f.title}
                {f.required && <span className="text-destructive">*</span>}
                <span className="font-mono text-[10px] text-muted-foreground">{f.key}</span>
              </Label>
              {f.enumValues && f.enumValues.length > 0 ? (
                <select
                  id={`apf-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setFieldValue(f.key, e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">—</option>
                  {f.enumValues.map((ev, i) => (
                    <option key={ev} value={ev}>
                      {f.enumTitles?.[i] ?? ev}
                    </option>
                  ))}
                </select>
              ) : f.type === "boolean" ? (
                <select
                  id={`apf-${f.key}`}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setFieldValue(f.key, e.target.value)}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="">—</option>
                  <option value="true">Sí</option>
                  <option value="false">No</option>
                </select>
              ) : f.type === "array" || f.editor === "textarea" ? (
                <textarea
                  id={`apf-${f.key}`}
                  rows={f.type === "array" ? 3 : 2}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setFieldValue(f.key, e.target.value)}
                  placeholder={f.type === "array" ? "un valor por línea" : ""}
                  className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                />
              ) : (
                <Input
                  id={`apf-${f.key}`}
                  type={f.type === "integer" || f.type === "number" ? "number" : "text"}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setFieldValue(f.key, e.target.value)}
                />
              )}
              {f.description && (
                <p className="text-[10px] text-muted-foreground">{f.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
