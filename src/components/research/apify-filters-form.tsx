"use client";

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
  PLATFORMS,
  type Platform,
  type FilterDef,
  type FilterValue,
} from "@/lib/apify/platforms";

/**
 * Form genérico de filtros extra para un Actor Apify, generado a partir de
 * `PLATFORMS[platform].filters`. Cada plataforma expone los campos nativos
 * más útiles (fecha, idioma, sort, país…) sin que el usuario tenga que
 * escribir JSON.
 *
 * Valor: `Record<string, FilterValue>` keyed by `FilterDef.key`.
 *   - Strings vacíos se conservan en estado pero el server los descarta
 *     (ver `sanitizeFilters` en `lib/apify/platforms.ts`).
 */
export function ApifyFiltersForm({
  platform,
  value,
  onChange,
  disabled,
  /** Sentinel value usado por el <Select> cuando se quiere representar "vacío".
   *  El componente Select de shadcn no permite SelectItem con value="". */
  emptyToken = "__none",
  className,
}: {
  platform: Platform;
  value: Record<string, FilterValue>;
  onChange: (next: Record<string, FilterValue>) => void;
  disabled?: boolean;
  emptyToken?: string;
  className?: string;
}) {
  const def = PLATFORMS[platform];
  if (!def.filters.length) return null;

  function setField(key: string, v: FilterValue) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div
      className={`grid gap-3 rounded-lg border border-border/40 bg-background/30 p-3 md:grid-cols-2 ${className ?? ""}`}
    >
      <div className="md:col-span-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Filtros del actor — {def.label}
        <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70">
          Vacíos = sin filtro
        </span>
      </div>
      {def.filters.map((f) => (
        <FilterField
          key={f.key}
          def={f}
          value={value[f.key] ?? null}
          onChange={(v) => setField(f.key, v)}
          disabled={disabled}
          emptyToken={emptyToken}
        />
      ))}
    </div>
  );
}

function FilterField({
  def: f,
  value,
  onChange,
  disabled,
  emptyToken,
}: {
  def: FilterDef;
  value: FilterValue;
  onChange: (v: FilterValue) => void;
  disabled?: boolean;
  emptyToken: string;
}) {
  const id = `apf-${f.key}`;
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id} className="text-xs">
        {f.label}
      </Label>

      {f.type === "string" && (
        <Input
          id={id}
          type="text"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="h-9"
        />
      )}

      {f.type === "number" && (
        <Input
          id={id}
          type="number"
          disabled={disabled}
          min={f.min}
          max={f.max}
          placeholder={f.placeholder}
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "") return onChange(null);
            const n = Number(raw);
            onChange(Number.isFinite(n) ? n : null);
          }}
          className="h-9"
        />
      )}

      {f.type === "date" && (
        <Input
          id={id}
          type="date"
          disabled={disabled}
          value={
            typeof value === "string"
              ? // Aceptamos tanto "YYYY-MM-DD" como ISO (cortamos los primeros 10 chars).
                value.length >= 10
                ? value.slice(0, 10)
                : value
              : ""
          }
          onChange={(e) => onChange(e.target.value || null)}
          className="h-9"
        />
      )}

      {f.type === "select" && (
        <Select
          disabled={disabled}
          value={
            typeof value === "string" && value !== ""
              ? value
              : f.options.some((o) => o.value === "")
                ? emptyToken
                : (f.default ?? emptyToken)
          }
          onValueChange={(v) => onChange(v === emptyToken ? null : v)}
        >
          <SelectTrigger id={id} className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {f.options.map((o) => (
              <SelectItem
                key={o.value || emptyToken}
                value={o.value === "" ? emptyToken : o.value}
              >
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {f.type === "boolean" && (
        <label
          htmlFor={id}
          className="flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm"
        >
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          <span className="text-xs text-muted-foreground">
            {f.hint ?? f.label}
          </span>
        </label>
      )}

      {f.hint && f.type !== "boolean" && (
        <span className="text-[10px] text-muted-foreground">{f.hint}</span>
      )}
    </div>
  );
}

/**
 * Construye el estado inicial de filtros aplicando los `default` declarados
 * en la plataforma (los que no tengan default arrancan en null/empty).
 */
export function defaultFiltersFor(
  platform: Platform,
): Record<string, FilterValue> {
  const def = PLATFORMS[platform];
  const out: Record<string, FilterValue> = {};
  for (const f of def.filters) {
    if ("default" in f && f.default !== undefined) {
      out[f.key] = f.default;
    } else {
      out[f.key] = null;
    }
  }
  return out;
}
