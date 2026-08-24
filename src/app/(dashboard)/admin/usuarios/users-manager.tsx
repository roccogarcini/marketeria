"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Trash2,
  Plus,
  Loader2,
  KeyRound,
  UserX,
  UserCheck,
  Copy,
  Check,
  X,
} from "lucide-react";

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

const roles = ["ADMIN", "EDITOR", "VIEWER"] as const;

export function UsersManager({ initialUsers }: { initialUsers: User[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "EDITOR" as (typeof roles)[number] });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al crear usuario");
      return;
    }
    setForm({ email: "", name: "", password: "", role: "EDITOR" });
    setCreating(false);
    startTransition(() => router.refresh());
  }

  const [busyId, setBusyId] = useState<string | null>(null);

  async function updateUser(id: string, patch: Partial<{ role: string; isActive: boolean }>) {
    setError(null);
    setBusyId(id);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al actualizar");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function deleteUser(id: string) {
    if (
      !confirm(
        "¿Eliminar este usuario?\n\nSu histórico (contenidos, ideas, actividad y consumo IA) se conserva. " +
          "Se borran sus credenciales y accesos, y ya no podrá entrar. Esta acción no se puede deshacer.",
      )
    )
      return;
    setError(null);
    setBusyId(id);
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al eliminar");
      return;
    }
    startTransition(() => router.refresh());
  }

  // Enlace de restablecimiento de contraseña generado para un usuario.
  const [resetLink, setResetLink] = useState<{
    userId: string;
    email: string;
    link: string;
    emailed: boolean;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  async function generateResetLink(u: User) {
    setError(null);
    setCopied(false);
    setBusyId(u.id);
    const res = await fetch(`/api/admin/users/${u.id}/reset-password`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "No se pudo generar el enlace de restablecimiento");
      return;
    }
    setResetLink({ userId: u.id, email: u.email, link: data.link, emailed: !!data.emailed });
  }

  async function copyResetLink() {
    if (!resetLink) return;
    try {
      await navigator.clipboard.writeText(resetLink.link);
      setCopied(true);
    } catch {
      /* el enlace sigue visible para copiar a mano */
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="display-md">Usuarios</h1>
          <p className="text-sm text-muted-foreground">Gestión de cuentas y roles.</p>
        </div>
        <Button onClick={() => setCreating((v) => !v)}>
          <Plus className="h-4 w-4" /> Nuevo usuario
        </Button>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {resetLink && (
        <div className="glass-card flex flex-col gap-2 border-primary/30 p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Enlace de restablecimiento para {resetLink.email}
            </p>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setResetLink(null)}
              aria-label="Cerrar"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Input readOnly value={resetLink.link} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" size="sm" onClick={copyResetLink}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Válido 1 hora y de un solo uso.{" "}
            {resetLink.emailed
              ? "También se ha enviado por email al usuario."
              : "No se envió por email (SMTP sin configurar): compárteselo tú."}
          </p>
        </div>
      )}

      {creating && (
        <form onSubmit={onCreate} className="glass-card grid gap-3 p-4 md:grid-cols-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="u-email">Email</Label>
            <Input id="u-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="u-name">Nombre</Label>
            <Input id="u-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="u-pass">Contraseña</Label>
            <Input id="u-pass" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="u-role">Rol</Label>
            <Select
              value={form.role}
              onValueChange={(v) => setForm({ ...form, role: v as (typeof roles)[number] })}
            >
              <SelectTrigger id="u-role" className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Crear
            </Button>
          </div>
        </form>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Email</th>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Rol</th>
              <th className="px-3 py-2 text-left">Estado</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initialUsers.map((u) => (
              <tr key={u.id} className="border-t border-border/40">
                <td className="px-3 py-2">{u.email}</td>
                <td className="px-3 py-2">{u.name}</td>
                <td className="px-3 py-2">
                  <Select
                    value={u.role}
                    onValueChange={(v) => updateUser(u.id, { role: v })}
                  >
                    <SelectTrigger className="h-8 w-auto min-w-[7rem] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={u.isActive ? "default" : "outline"}>
                    {u.isActive ? "Activo" : "Desactivado"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => generateResetLink(u)}
                      disabled={busyId === u.id || !u.isActive}
                      title={
                        u.isActive
                          ? "Generar enlace de restablecimiento de contraseña"
                          : "Actívalo para poder generar el enlace"
                      }
                    >
                      {busyId === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <KeyRound className="h-3.5 w-3.5" />
                      )}
                      Reset contraseña
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => updateUser(u.id, { isActive: !u.isActive })}
                      disabled={busyId === u.id}
                      title={
                        u.isActive
                          ? "Desactivar: el usuario no podrá iniciar sesión (reversible)"
                          : "Activar: el usuario podrá volver a iniciar sesión"
                      }
                    >
                      {u.isActive ? (
                        <UserX className="h-3.5 w-3.5" />
                      ) : (
                        <UserCheck className="h-3.5 w-3.5" />
                      )}
                      {u.isActive ? "Desactivar" : "Activar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteUser(u.id)}
                      disabled={busyId === u.id}
                      aria-label="Eliminar"
                      title="Eliminar (su histórico se conserva)"
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
      <p className="text-xs text-muted-foreground">
        Desactivar bloquea el acceso sin tocar nada más (reversible). Eliminar
        borra credenciales y accesos pero conserva todo su histórico
        (contenidos, ideas, actividad y consumo IA).
      </p>
    </div>
  );
}
