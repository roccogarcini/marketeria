"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2, MessageCircle, Save, Copy, Check } from "lucide-react";

type WhatsAppConfig = {
  enabled: boolean;
  hasVerifyToken: boolean;
  hasAppSecret: boolean;
  sourceId: string | null;
};

type SourceInfo = { id: string; name: string; findings: number } | null;

export function WhatsAppSection({
  initial,
  source,
  origin,
}: {
  initial: WhatsAppConfig;
  source: SourceInfo;
  origin: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState({
    enabled: initial.enabled,
    verifyToken: "",
    appSecret: "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const callbackUrl = `${origin}/api/webhooks/whatsapp`;

  async function copiar() {
    await navigator.clipboard.writeText(callbackUrl).catch(() => {});
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    setError(null);
    const res = await fetch("/api/admin/whatsapp", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: form.enabled,
        // Solo viajan si se han escrito: un campo vacío significa "no lo toques".
        ...(form.verifyToken ? { verifyToken: form.verifyToken } : {}),
        ...(form.appSecret ? { appSecret: form.appSecret } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "Error guardando la configuración de WhatsApp.");
      return;
    }
    setForm((f) => ({ ...f, verifyToken: "", appSecret: "" }));
    setMsg("Configuración guardada.");
    startTransition(() => router.refresh());
  }

  return (
    <section className="glass-card flex flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-foreground" />
          <div>
            <h2 className="text-base font-semibold">WhatsApp (entrada)</h2>
            <p className="text-xs text-muted-foreground">
              Los mensajes que llegan a tu número de WhatsApp Business entran en
              la bandeja de hallazgos como una fuente más.
            </p>
          </div>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-sm">
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
          {form.enabled ? "Activo" : "Inactivo"}
        </label>
      </div>

      <div className="flex flex-col gap-1.5 rounded-lg border border-border/40 bg-background/30 p-3">
        <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
          URL de devolución de llamada
        </Label>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs">
            {callbackUrl}
          </code>
          <Button variant="outline" size="sm" onClick={copiar} className="shrink-0 gap-1.5">
            {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? "Copiada" : "Copiar"}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Pégala en Meta &rarr; tu app &rarr; WhatsApp &rarr; Configuración &rarr;
          Webhook, y suscríbete al campo <code>messages</code>. Tiene que ser
          <strong> https y accesible desde internet</strong>: en local no
          funciona salvo que la expongas con un túnel.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="wa-verify">
            Token de verificación{" "}
            {initial.hasVerifyToken && <span className="text-muted-foreground">(guardado)</span>}
          </Label>
          <Input
            id="wa-verify"
            type="password"
            value={form.verifyToken}
            onChange={(e) => setForm({ ...form, verifyToken: e.target.value })}
            placeholder={
              initial.hasVerifyToken ? "•••••••• (deja vacío para no cambiar)" : "El que inventes tú"
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Te lo inventas tú y lo escribes igual en Meta. Solo se usa al dar de
            alta el webhook.
          </p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="wa-secret">
            Secreto de la app{" "}
            {initial.hasAppSecret && <span className="text-muted-foreground">(guardado)</span>}
          </Label>
          <Input
            id="wa-secret"
            type="password"
            value={form.appSecret}
            onChange={(e) => setForm({ ...form, appSecret: e.target.value })}
            placeholder={
              initial.hasAppSecret ? "•••••••• (deja vacío para no cambiar)" : "App Secret de Meta"
            }
          />
          <p className="text-[11px] text-muted-foreground">
            Lo da Meta en Configuración de la app &rarr; Básica. Con él se
            comprueba la firma de cada evento.
          </p>
        </div>
      </div>

      {source && (
        <p className="text-xs text-muted-foreground">
          Fuente que los recibe: <strong>{source.name}</strong> ·{" "}
          {source.findings} {source.findings === 1 ? "hallazgo" : "hallazgos"}.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={busy} className="gap-1.5">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </section>
  );
}
