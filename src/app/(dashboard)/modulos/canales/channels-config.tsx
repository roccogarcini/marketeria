"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Linkedin,
  Twitter,
  Instagram,
  Mail,
  BookOpen,
  LayoutGrid,
  Wrench,
  Loader2,
  Save,
  Plus,
  Trash2,
  Power,
  type LucideIcon,
} from "lucide-react";

type Channel = {
  id: string;
  name: string;
  type: string;
  constraintsJson: string | null;
  templateMarkdown: string | null;
  systemPrompt: string | null;
  agentId: string | null;
  isActive: boolean;
  sortOrder: number;
};

type AgentOption = { id: string; name: string; role: string };

const TYPES = [
  "LINKEDIN",
  "BLOG",
  "NEWSLETTER",
  "INSTAGRAM",
  "TWITTER",
  "CAROUSEL",
  "CUSTOM",
] as const;

function iconFor(type: string): LucideIcon {
  const t = type.toUpperCase();
  if (t === "LINKEDIN") return Linkedin;
  if (t === "TWITTER") return Twitter;
  if (t === "INSTAGRAM") return Instagram;
  if (t === "NEWSLETTER") return Mail;
  if (t === "BLOG") return BookOpen;
  if (t === "CAROUSEL") return LayoutGrid;
  return Wrench;
}

export function ChannelsConfig({
  initial,
  agents,
}: {
  initial: Channel[];
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selectedId, setSelectedId] = useState<string | null>(
    initial[0]?.id ?? null,
  );
  const [creating, setCreating] = useState(false);
  const [newForm, setNewForm] = useState({
    name: "",
    type: "LINKEDIN" as (typeof TYPES)[number],
  });
  const [error, setError] = useState<string | null>(null);

  const selected = initial.find((c) => c.id === selectedId) ?? null;

  async function createChannel(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newForm.name, type: newForm.type }),
    });
    if (!res.ok) {
      setError("Error creando canal");
      return;
    }
    const data = await res.json();
    setNewForm({ name: "", type: "LINKEDIN" });
    setCreating(false);
    setSelectedId(data.channel?.id ?? null);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      {/* Sidebar lista */}
      <aside className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Canales ({initial.length})
          </h2>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating((v) => !v)}
            className="gap-1"
          >
            <Plus className="h-3.5 w-3.5" /> Nuevo
          </Button>
        </div>

        {creating && (
          <form
            onSubmit={createChannel}
            className="glass-card flex flex-col gap-2 p-3"
          >
            <Input
              placeholder="Nombre"
              required
              value={newForm.name}
              onChange={(e) => setNewForm({ ...newForm, name: e.target.value })}
            />
            <Select
              value={newForm.type}
              onValueChange={(v) =>
                setNewForm({ ...newForm, type: v as (typeof TYPES)[number] })
              }
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm">
              Crear
            </Button>
          </form>
        )}

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          {initial.map((c) => {
            const Icon = iconFor(c.type);
            const active = selectedId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-primary/60 bg-primary/[0.08]"
                    : "border-border/40 bg-background/30 hover:border-primary/30"
                }`}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-foreground">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{c.name}</span>
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    {c.type}
                    {!c.isActive && " · inactivo"}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Editor detalle */}
      <main>
        {selected ? (
          <ChannelEditor key={selected.id} channel={selected} agents={agents} />
        ) : (
          <div className="rounded-xl border border-dashed border-border/50 p-8 text-center text-sm text-muted-foreground">
            Selecciona un canal o crea uno nuevo.
          </div>
        )}
      </main>
    </div>
  );
}

function ChannelEditor({
  channel,
  agents,
}: {
  channel: Channel;
  agents: AgentOption[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    name: channel.name,
    type: channel.type as (typeof TYPES)[number],
    isActive: channel.isActive,
    constraintsJson: channel.constraintsJson ?? "",
    templateMarkdown: channel.templateMarkdown ?? "",
    systemPrompt: channel.systemPrompt ?? "",
    agentId: channel.agentId ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    // Validamos JSON si no está vacío.
    if (form.constraintsJson.trim()) {
      try {
        JSON.parse(form.constraintsJson);
      } catch {
        setErr("constraintsJson no es JSON válido");
        setSaving(false);
        return;
      }
    }
    const res = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        type: form.type,
        isActive: form.isActive,
        constraintsJson: form.constraintsJson.trim() || null,
        templateMarkdown: form.templateMarkdown.trim() || null,
        systemPrompt: form.systemPrompt.trim() || null,
        agentId: form.agentId || null,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setErr(data.error ?? "Error al guardar");
      return;
    }
    setMsg("Cambios guardados.");
    startTransition(() => router.refresh());
  }

  async function remove() {
    if (!confirm("¿Eliminar canal? Se borran también sus piezas.")) return;
    const res = await fetch(`/api/channels/${channel.id}`, {
      method: "DELETE",
    });
    if (!res.ok) return;
    startTransition(() => router.refresh());
  }

  async function toggle() {
    const next = !form.isActive;
    setForm({ ...form, isActive: next });
    await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    startTransition(() => router.refresh());
  }

  const Icon = iconFor(form.type);

  return (
    <div className="flex flex-col gap-5">
      <div className="glass-card flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-foreground">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold">{form.name}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                {form.type}
              </Badge>
              {!form.isActive && (
                <Badge variant="outline" className="text-[10px]">
                  INACTIVO
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={toggle} className="gap-1.5">
            <Power className="h-3.5 w-3.5" />
            {form.isActive ? "Desactivar" : "Activar"}
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} aria-label="Eliminar">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Básicos */}
      <section className="glass-card grid gap-4 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-name">Nombre</Label>
          <Input
            id="ed-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ed-type">Tipo</Label>
          <Select
            value={form.type}
            onValueChange={(v) => setForm({ ...form, type: v as (typeof TYPES)[number] })}
          >
            <SelectTrigger id="ed-type" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Agente del canal: es quien redacta las creaciones de este canal */}
      <section className="glass-card flex flex-col gap-2 p-5">
        <Label htmlFor="ed-agent" className="flex flex-col gap-0.5">
          <span>Agente del canal (quién redacta)</span>
          <span className="text-[10px] font-normal text-muted-foreground">
            Con un agente asignado, normalmente no necesitas configurar nada
            más: él sabe redactar para este canal. Sus prompts se editan en
            /agentes.
          </span>
        </Label>
        <select
          id="ed-agent"
          value={form.agentId}
          onChange={(e) => setForm({ ...form, agentId: e.target.value })}
          className="flex h-9 w-full max-w-md rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Sin agente (usar la configuración avanzada)</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.role.slice(0, 60)}
            </option>
          ))}
        </select>
      </section>

      {/* Configuración avanzada: los 3 campos técnicos, plegados y explicados.
          Con agente asignado son opcionales (ajustes finos); sin agente, el
          "Prompt del canal" pasa a ser quien dirige la redacción. */}
      <details className="glass-card p-5">
        <summary className="cursor-pointer text-sm font-medium">
          Configuración avanzada (opcional)
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            ajustes finos por canal — con agente asignado no suele hacer falta
          </span>
        </summary>
        <div className="mt-4 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ed-sys" className="flex flex-col gap-0.5">
              <span>Reglas extra del canal</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Instrucciones que se AÑADEN al prompt del agente (p. ej. «máximo
                900 caracteres», «siempre 3 hashtags», «firma con —Equipo X»).
                Si el canal no tiene agente, esto pasa a ser el prompt
                principal de redacción.
              </span>
            </Label>
            <Textarea
              id="ed-sys"
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              placeholder="Ej: Máximo 900 caracteres. Siempre 3 hashtags al final. Nunca menciones a la competencia."
              className="min-h-[120px] font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ed-constraints" className="flex flex-col gap-0.5">
              <span>Límites técnicos (JSON)</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Datos estructurados del canal que se pasan a la IA como
                configuración: longitud máxima, formato… Ejemplo:{" "}
                <code>{'{"maxLength": 1300, "format": "text-only"}'}</code>. Si
                no lo necesitas, déjalo vacío.
              </span>
            </Label>
            <Textarea
              id="ed-constraints"
              value={form.constraintsJson}
              onChange={(e) => setForm({ ...form, constraintsJson: e.target.value })}
              placeholder='{"maxLength": 1300}'
              className="min-h-[90px] font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ed-template" className="flex flex-col gap-0.5">
              <span>Ejemplo de estructura</span>
              <span className="text-[10px] font-normal text-muted-foreground">
                Un ejemplo de cómo quieres que se vea el resultado (la IA lo
                imita). Útil para formatos muy concretos; si no, déjalo vacío.
              </span>
            </Label>
            <Textarea
              id="ed-template"
              value={form.templateMarkdown}
              onChange={(e) => setForm({ ...form, templateMarkdown: e.target.value })}
              placeholder={"# Titular\n\nPárrafo gancho…\n\n- Punto 1\n- Punto 2\n\nCTA final"}
              className="min-h-[90px] font-mono text-xs"
            />
          </div>
        </div>
      </details>

      {/* Guardar */}
      <div className="flex items-center justify-between gap-3">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {msg && <p className="text-sm text-foreground">{msg}</p>}
        <div className="ml-auto">
          <Button onClick={save} disabled={saving} className="gap-1.5">
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Guardar cambios
          </Button>
        </div>
      </div>
    </div>
  );
}
