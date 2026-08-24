"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Check, Copy, Loader2, X, Zap } from "lucide-react";

type Props = {
  initial: { enabled: boolean; clientId: string | null; clientSecretMasked: string | null };
  origin: string;
};

export function GoogleAuthSection({ initial, origin }: Props) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [secretMasked, setSecretMasked] = useState(initial.clientSecretMasked);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const redirectUri = `${origin}/api/auth/callback/google`;

  async function copy(text: string, key: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  async function save(next?: { enabled?: boolean }) {
    setBusy("save");
    setMsg(null);
    const res = await fetch("/api/admin/google-auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: next?.enabled ?? enabled,
        clientId,
        ...(clientSecret.trim() ? { clientSecret } : {}),
      }),
    });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: data.error ?? "No se pudo guardar" });
      return;
    }
    setSecretMasked(data.clientSecretMasked ?? secretMasked);
    setClientSecret("");
    setMsg({ ok: true, text: "Configuración guardada." });
  }

  async function test() {
    setBusy("test");
    setMsg(null);
    const res = await fetch("/api/admin/google-auth/test", { method: "POST" });
    setBusy(null);
    const data = await res.json().catch(() => ({}));
    setMsg({ ok: !!data.ok, text: data.ok ? data.detail : data.error ?? "Falló la prueba" });
  }

  return (
    <section className="glass-card flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-widest text-foreground/80">
            Login con Google
          </h2>
          <p className="text-xs text-muted-foreground">
            Opcional. Solo pueden entrar emails que ya existan como usuarios
            activos — Google nunca crea cuentas nuevas.
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            void save({ enabled: v });
          }}
          aria-label="Activar login con Google"
        />
      </div>

      {enabled && (
        <>
          <div className="rounded-xl border border-border/50 bg-background/30 p-3 text-xs">
            <p className="mb-2 font-medium text-foreground">
              Configura esto en Google Cloud Console → APIs y servicios →
              Credenciales → ID de cliente OAuth (aplicación web):
            </p>
            <div className="flex flex-col gap-2">
              {[
                { k: "origin", label: "Orígenes autorizados de JavaScript", value: origin },
                { k: "redirect", label: "URI de redirección autorizado", value: redirectUri },
              ].map((row) => (
                <div key={row.k} className="flex flex-col gap-1">
                  <span className="text-muted-foreground">{row.label}</span>
                  <div className="flex items-center gap-1">
                    <code className="flex-1 overflow-x-auto rounded-md border border-border/50 bg-background/60 px-2 py-1.5 font-mono">
                      {row.value}
                    </code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => copy(row.value, row.k)}
                      aria-label={`Copiar ${row.label}`}
                    >
                      {copied === row.k ? (
                        <Check className="h-3.5 w-3.5 text-ok" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-client-id">Client ID</Label>
              <Input
                id="g-client-id"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxxx.apps.googleusercontent.com"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="g-client-secret">Client Secret</Label>
              <Input
                id="g-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={secretMasked ?? "GOCSPX-…"}
              />
              {secretMasked && !clientSecret && (
                <p className="text-[11px] text-muted-foreground">
                  Guardado ({secretMasked}). Deja vacío para conservarlo.
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" onClick={() => save()} disabled={busy !== null}>
              {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={test}
              disabled={busy !== null}
              className="gap-1.5"
            >
              {busy === "test" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              Probar conexión
            </Button>
          </div>
        </>
      )}

      {msg && (
        <p
          className={`inline-flex items-center gap-1.5 text-sm ${
            msg.ok ? "text-ok" : "text-destructive"
          }`}
        >
          {msg.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
          {msg.text}
        </p>
      )}
    </section>
  );
}
