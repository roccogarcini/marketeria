"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, Copy, Check, Power, Plug } from "lucide-react";

type ApiKeyRow = {
  id: string;
  name: string;
  prefix: string;
  scope: string;
  isActive: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export function ApiKeysManager({
  initial,
  baseUrl,
}: {
  initial: ApiKeyRow[];
  /** URL pública de esta instancia (NEXTAUTH_URL o host del proxy). */
  baseUrl: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "read_write">("read");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // La clave completa solo existe en esta respuesta — se enseña una vez.
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createKey(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNewKey(null);
    setBusy("create");
    const res = await fetch("/api/admin/api-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, scope }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setError(data.error ?? "No se pudo crear la clave");
      return;
    }
    setNewKey(data.key);
    setName("");
    startTransition(() => router.refresh());
  }

  async function toggle(id: string, isActive: boolean) {
    setBusy(id);
    await fetch(`/api/admin/api-keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !isActive }),
    });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (!confirm("¿Revocar esta clave definitivamente? Las apps que la usen dejarán de funcionar.")) return;
    setBusy(id);
    await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" });
    setBusy(null);
    startTransition(() => router.refresh());
  }

  async function copyKey() {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // URLs reales de conexión de ESTA instancia + copiar al portapapeles.
  const mcpUrl = baseUrl ? `${baseUrl}/api/mcp` : "/api/mcp";
  const restUrl = baseUrl ? `${baseUrl}/api/v1` : "/api/v1";
  const mcpCommand = `claude mcp add --transport http spaider ${mcpUrl} --header "Authorization: Bearer spk_..."`;
  const [copiedWhat, setCopiedWhat] = useState<string | null>(null);
  async function copyText(what: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedWhat(what);
    setTimeout(() => setCopiedWhat(null), 1500);
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Claves API / MCP</h1>
        <p className="text-sm text-muted-foreground">
          Conecta otras apps (REST) y agentes como Claude Code u otros agentes (MCP).
          La clave completa solo se muestra al crearla; guárdala en un lugar seguro.
        </p>
      </header>

      {/* URLs de conexión de esta instancia — visibles y copiables */}
      <section className="glass-card flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Plug className="h-4 w-4 text-foreground" />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            URLs de conexión
          </h2>
        </div>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
              MCP
            </span>
            <code className="break-all rounded-md bg-background/60 px-3 py-1.5 font-mono text-xs">
              {mcpUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => copyText("mcp", mcpUrl)}
            >
              {copiedWhat === "mcp" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copiar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
              API REST
            </span>
            <code className="break-all rounded-md bg-background/60 px-3 py-1.5 font-mono text-xs">
              {restUrl}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => copyText("rest", restUrl)}
            >
              {copiedWhat === "rest" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copiar
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
              Claude Code
            </span>
            <code className="min-w-0 flex-1 basis-64 break-all rounded-md bg-background/60 px-3 py-1.5 font-mono text-xs">
              {mcpCommand}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => copyText("cmd", mcpCommand)}
            >
              {copiedWhat === "cmd" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              Copiar
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Sustituye <code>spk_...</code> por una clave creada abajo. tu agente y
          otros clientes MCP usan la misma URL con la cabecera{" "}
          <code>Authorization: Bearer spk_...</code>
        </p>
      </section>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {newKey && (
        <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-primary/10 p-4">
          <p className="text-sm font-semibold">
            Clave creada — cópiala AHORA (no volverá a mostrarse):
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded-md bg-background/60 px-3 py-2 font-mono text-xs">
              {newKey}
            </code>
            <Button size="sm" variant="outline" onClick={copyKey} className="gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiada" : "Copiar"}
            </Button>
          </div>
        </div>
      )}

      {/* Crear clave */}
      <form onSubmit={createKey} className="glass-card grid gap-3 p-4 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="k-name">Nombre (para qué app/agente es)</Label>
          <Input
            id="k-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Claude Code, mi publicador…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="k-scope">Permisos</Label>
          <select
            id="k-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as "read" | "read_write")}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="read">Solo lectura</option>
            <option value="read_write">Lectura y escritura</option>
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={busy === "create"} className="gap-1.5">
            {busy === "create" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Crear clave
          </Button>
        </div>
      </form>

      {/* Lista */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Clave</th>
              <th className="px-3 py-2 text-left">Permisos</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-left">Último uso</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Sin claves. Crea una para conectar tus apps.
                </td>
              </tr>
            )}
            {initial.map((k) => (
              <tr key={k.id} className="border-t border-border/40">
                <td className="px-3 py-2 font-medium">{k.name}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{k.prefix}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-[10px]">
                    {k.scope === "read_write" ? "lectura/escritura" : "solo lectura"}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={k.isActive ? "default" : "outline"}>
                    {k.isActive ? "Activa" : "Desactivada"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {k.lastUsedAt
                    ? new Date(k.lastUsedAt).toLocaleString("es-ES")
                    : "Nunca"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggle(k.id, k.isActive)}
                      disabled={busy === k.id}
                      className="gap-1.5"
                    >
                      <Power className="h-3.5 w-3.5" />
                      {k.isActive ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(k.id)}
                      disabled={busy === k.id}
                      aria-label="Revocar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Documentación de conexión */}
      <section className="glass-card flex flex-col gap-4 p-5 text-sm">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Cómo conectar
        </h2>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">API REST (otras apps, n8n, Zapier…)</p>
          <pre className="overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-xs leading-relaxed">
{`# Base: ${restUrl}
# Autenticación: Authorization: Bearer spk_...
GET  ${restUrl}/findings?status=NEW      # hallazgos
GET  ${restUrl}/ideas?status=APPROVED    # ideas
GET  ${restUrl}/assets                   # creaciones (con su cuerpo)
GET  ${restUrl}/channels                 # canales activos
POST ${restUrl}/research   { "brief": "..." }                     # investigar
POST ${restUrl}/findings   { "title": "...", "url": "..." }       # insertar hallazgo
POST ${restUrl}/ideas      { "title": "...", "approved": true }   # crear idea
POST ${restUrl}/creations  { "title": "...", "body": "...",
                             "channelType": "NEWSLETTER" }        # insertar creación hecha fuera
POST ${restUrl}/produce    { "ideaId": "...", "channelIds": [] }  # producir`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Los POST requieren una clave de lectura/escritura.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="font-medium">MCP (Claude Code y otros agentes)</p>
          <pre className="overflow-x-auto rounded-lg bg-background/60 p-3 font-mono text-xs leading-relaxed">
{`claude mcp add --transport http spaider ${mcpUrl} \\
  --header "Authorization: Bearer spk_..."`}
          </pre>
          <p className="text-xs text-muted-foreground">
            Herramientas expuestas: run_research, list_findings, create_finding,
            list_ideas, create_idea, create_creation, produce_content,
            list_assets, list_channels. Otros clientes MCP: mismo
            endpoint <code>/api/mcp</code> y misma cabecera.
          </p>
        </div>
      </section>
    </div>
  );
}
