"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save } from "lucide-react";

export function ProfileForm({ initial }: { initial: { name: string; email: string } }) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== initial.email.toLowerCase();
  const wantsPasswordChange = newPassword.length > 0 || repeatPassword.length > 0;
  const needsCurrent = emailChanged || wantsPasswordChange;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (wantsPasswordChange && newPassword !== repeatPassword) {
      setError("La contraseña nueva no coincide en los dos campos.");
      return;
    }
    if (wantsPasswordChange && newPassword.length < 8) {
      setError("La contraseña nueva debe tener al menos 8 caracteres.");
      return;
    }
    if (needsCurrent && !currentPassword) {
      setError("Introduce tu contraseña actual para confirmar el cambio.");
      return;
    }

    setBusy(true);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(name.trim() !== initial.name ? { name: name.trim() } : {}),
        ...(emailChanged ? { email: email.trim() } : {}),
        ...(wantsPasswordChange ? { newPassword } : {}),
        ...(needsCurrent ? { currentPassword } : {}),
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error ?? "No se pudo guardar el perfil");
      return;
    }
    if (data.requiresRelogin) {
      // Email/contraseña cambiados: la sesión actual queda obsoleta.
      await signOut({ callbackUrl: "/login" });
      return;
    }
    setMessage("Perfil actualizado. El nombre del menú se refresca al volver a entrar.");
    setCurrentPassword("");
    setNewPassword("");
    setRepeatPassword("");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}

      <section className="glass-card flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Datos
        </h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-name">Nombre</Label>
          <Input id="pf-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-email">Email</Label>
          <Input
            id="pf-email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailChanged && (
            <p className="text-xs text-muted-foreground">
              Cambiar el email cierra la sesión: entrarás con el nuevo.
            </p>
          )}
        </div>
      </section>

      <section className="glass-card flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
          Cambiar contraseña
        </h2>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-new">Contraseña nueva</Label>
          <Input
            id="pf-new"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Mínimo 8 caracteres (vacío = no cambiar)"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="pf-repeat">Repite la contraseña nueva</Label>
          <Input
            id="pf-repeat"
            type="password"
            autoComplete="new-password"
            value={repeatPassword}
            onChange={(e) => setRepeatPassword(e.target.value)}
          />
        </div>
      </section>

      {needsCurrent && (
        <section className="glass-card flex flex-col gap-3 border-primary/30 p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="pf-current">Contraseña actual (confirma el cambio)</Label>
            <Input
              id="pf-current"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        </section>
      )}

      <div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}
