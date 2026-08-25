"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { MarketeriaWordmark } from "@/components/brand/marketeria-logo";

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "No se pudo restablecer la contraseña.");
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/login"), 2000);
  }

  if (!token) {
    return (
      <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-3 text-sm text-destructive">
        Enlace inválido. Solicita uno nuevo desde{" "}
        <Link href="/forgot-password" className="underline">
          recuperar contraseña
        </Link>
        .
      </p>
    );
  }
  if (done) {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-3 text-foreground">
          Contraseña actualizada. Redirigiendo al login…
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="rp-pass" className="text-sm font-medium">
          Nueva contraseña
        </label>
        <input
          id="rp-pass"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Mínimo 8 caracteres"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="rp-confirm" className="text-sm font-medium">
          Repetir contraseña
        </label>
        <input
          id="rp-confirm"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={loading}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        Guardar nueva contraseña
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="glass-card w-full max-w-sm p-8">
      <div className="mb-8 flex flex-col items-center">
        <MarketeriaWordmark className="mb-5 h-14" />
        <p className="mt-1 text-sm text-muted-foreground">Nueva contraseña</p>
      </div>
      <Suspense fallback={<Loader2 className="mx-auto h-5 w-5 animate-spin" />}>
        <ResetForm />
      </Suspense>
    </div>
  );
}
