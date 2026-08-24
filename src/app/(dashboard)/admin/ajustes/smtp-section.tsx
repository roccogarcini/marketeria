"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, Save, Mail, Check, X } from "lucide-react";

type SmtpConfig = {
  enabled: boolean;
  host: string | null;
  port: number;
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
  from: string | null;
};

export function SmtpSection({ initial }: { initial: SmtpConfig }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    enabled: initial.enabled,
    host: initial.host ?? "",
    port: String(initial.port ?? 587),
    secure: initial.secure,
    user: initial.user ?? "",
    password: "",
    from: initial.from ?? "",
  });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);

  async function save() {
    setBusy("save");
    setMsg(null);
    const res = await fetch("/api/admin/smtp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: form.enabled,
        host: form.host.trim() || null,
        port: Number(form.port) || 587,
        secure: form.secure,
        user: form.user.trim() || null,
        // Solo enviamos la contraseña si la han escrito (no pisar la guardada).
        ...(form.password ? { password: form.password } : {}),
        from: form.from.trim() || null,
      }),
    });
    setBusy(null);
    if (!res.ok) {
      setMsg("Error guardando la configuración SMTP.");
      return;
    }
    setForm((f) => ({ ...f, password: "" }));
    setMsg("Configuración SMTP guardada.");
    startTransition(() => router.refresh());
  }

  async function testConn() {
    setBusy("test");
    setTest(null);
    const res = await fetch("/api/admin/smtp", { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setTest({ ok: !!data.ok, msg: data.ok ? "Conexión correcta" : data.error ?? "Falló" });
  }

  return (
    <section className="glass-card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-foreground" />
          <div>
            <h2 className="text-base font-semibold">Email (SMTP)</h2>
            <p className="text-xs text-muted-foreground">
              Para enviar los correos de &quot;recuperar contraseña&quot;. Google
              Workspace: <code>smtp-relay.gmail.com</code> (relay) o{" "}
              <code>smtp.gmail.com</code> con contraseña de aplicación.
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
          {form.enabled ? "Activo" : "Inactivo"}
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-host">Host</Label>
          <Input
            id="smtp-host"
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="smtp-relay.gmail.com"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="smtp-port">Puerto</Label>
            <Input
              id="smtp-port"
              type="number"
              value={form.port}
              onChange={(e) => setForm({ ...form, port: e.target.value })}
              placeholder="587"
            />
          </div>
          <div className="flex flex-col justify-end gap-1 pb-1">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={form.secure}
                onCheckedChange={(v) => setForm({ ...form, secure: v })}
              />
              SSL (465)
            </label>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-user">Usuario</Label>
          <Input
            id="smtp-user"
            value={form.user}
            onChange={(e) => setForm({ ...form, user: e.target.value })}
            placeholder="usuario@tudominio.com"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="smtp-pass">
            Contraseña {initial.hasPassword && <span className="text-muted-foreground">(guardada)</span>}
          </Label>
          <Input
            id="smtp-pass"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            placeholder={initial.hasPassword ? "•••••••• (deja vacío para no cambiar)" : "Contraseña de aplicación"}
          />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="smtp-from">Remitente (From)</Label>
          <Input
            id="smtp-from"
            value={form.from}
            onChange={(e) => setForm({ ...form, from: e.target.value })}
            placeholder='"SpAIder" <no-reply@tudominio.com>'
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy !== null} className="gap-1.5">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
        <Button variant="outline" onClick={testConn} disabled={busy !== null} className="gap-1.5">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
          Probar conexión
        </Button>
        {test && (
          <span className={`inline-flex items-center gap-1 text-xs ${test.ok ? "text-ok" : "text-destructive"}`}>
            {test.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {test.msg}
          </span>
        )}
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>
    </section>
  );
}
