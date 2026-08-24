"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Pencil, PackagePlus } from "lucide-react";
import { AgentIcon } from "@/components/agent/agent-icon";

type Agent = {
  id: string;
  slug: string;
  name: string;
  role: string;
  systemPrompt: string;
  isActive: boolean;
  icon: string | null;
};

export function AgentsGrid({ initial }: { initial: Agent[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    slug: "",
    name: "",
    role: "",
    systemPrompt: "",
  });
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error creando agente");
      return;
    }
    setForm({ slug: "", name: "", role: "", systemPrompt: "" });
    setCreating(false);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("¿Eliminar agente?")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  // Carga los agentes base de marketing.
  //   create  → solo crea los que faltan (no toca los existentes).
  //   restore → además actualiza los base existentes a la última versión.
  const [loadingBase, setLoadingBase] = useState<"create" | "restore" | null>(null);
  const [baseMsg, setBaseMsg] = useState<string | null>(null);
  async function loadBaseAgents(mode: "create" | "restore") {
    if (
      mode === "restore" &&
      !confirm(
        "Restaurar actualizará los agentes base a su última versión y PISARÁ las ediciones que hayas hecho en ellos (tus agentes con otros slugs no se tocan). ¿Continuar?",
      )
    )
      return;
    setLoadingBase(mode);
    setBaseMsg(null);
    setError(null);
    const res = await fetch("/api/agents/load-base", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const data = await res.json().catch(() => ({}));
    setLoadingBase(null);
    if (!res.ok) {
      setError(data.error ?? "No se pudieron cargar los agentes base");
      return;
    }
    const created = (data.created ?? []).length;
    const updated = (data.updated ?? []).length;
    const skipped = (data.skipped ?? []).length;
    const parts: string[] = [];
    if (created > 0) parts.push(`${created} creados`);
    if (updated > 0) parts.push(`${updated} actualizados a la última versión`);
    if (skipped > 0) parts.push(`${skipped} sin tocar`);
    setBaseMsg(
      parts.length > 0
        ? `Agentes base: ${parts.join(", ")}. Personaliza sus prompts a tu temática.`
        : "Los agentes base ya estaban al día.",
    );
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="display-md">Agentes</h1>
          <p className="text-sm text-muted-foreground">
            Fichas reutilizables con system prompt propio. Cada agente ejecuta
            con el proveedor LLM configurado en{" "}
            <span className="font-medium">/admin/proveedores</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => loadBaseAgents("create")}
            disabled={loadingBase !== null}
            title="Crea los agentes base de marketing que falten (nunca toca los existentes)"
          >
            {loadingBase === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <PackagePlus className="h-4 w-4" />
            )}
            Cargar agentes base
          </Button>
          <Button
            variant="ghost"
            onClick={() => loadBaseAgents("restore")}
            disabled={loadingBase !== null}
            title="Actualiza los agentes base existentes a su última versión (pisa tus ediciones en esos agentes)"
          >
            {loadingBase === "restore" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Restaurar a última versión
          </Button>
          <Button onClick={() => setCreating((v) => !v)}>
            <Plus className="h-4 w-4" /> Nuevo agente
          </Button>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {baseMsg && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {baseMsg}
        </div>
      )}

      {creating && (
        <form onSubmit={onCreate} className="glass-card grid gap-3 p-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="a-slug">Slug</Label>
            <Input id="a-slug" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })} pattern="[a-z0-9-]+" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="a-name">Nombre</Label>
            <Input id="a-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="a-role">Rol</Label>
            <Input id="a-role" required value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="a-sp">System prompt</Label>
            <Textarea id="a-sp" required rows={5} value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
            <span className="text-[10px] text-muted-foreground">
              Tras crear, podrás afinar temperatura, max tokens y elegir icono desde la edición.
            </span>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Crear
            </Button>
          </div>
        </form>
      )}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {initial.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin agentes todavía.</p>
        )}
        {initial.map((a) => (
          <div key={a.id} className="glass-card group flex flex-col gap-2 p-4">
            <Link
              href={`/agentes/${a.id}/editar`}
              className="flex items-start justify-between gap-2"
              aria-label={`Editar ${a.name}`}
            >
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-foreground">
                  <AgentIcon name={a.icon} className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-semibold group-hover:underline">{a.name}</h3>
                  <p className="text-xs text-muted-foreground">{a.role}</p>
                </div>
              </div>
              <Badge variant={a.isActive ? "default" : "outline"}>
                {a.isActive ? "Activo" : "Inactivo"}
              </Badge>
            </Link>
            <p className="line-clamp-3 text-xs text-muted-foreground">
              {a.systemPrompt}
            </p>
            <div className="flex items-center justify-between pt-1">
              <code className="font-mono text-[10px] text-muted-foreground">
                @{a.slug}
              </code>
              <div className="flex items-center gap-1">
                <Button
                  asChild
                  variant="ghost"
                  size="icon"
                  aria-label="Editar"
                  title="Editar"
                >
                  <Link href={`/agentes/${a.id}/editar`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(a.id)}
                  aria-label="Eliminar"
                  title="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
