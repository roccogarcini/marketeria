"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { SpiderLogo } from "@/components/brand/spider-logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => {});
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="glass-card w-full max-w-sm p-8">
      <div className="mb-8 flex flex-col items-center">
        <SpiderLogo className="mb-3 h-14 w-14 text-foreground" />
        <h1 className="font-serif text-2xl italic">SpAIder</h1>
        <p className="mt-1 text-sm text-muted-foreground">Recuperar contraseña</p>
      </div>

      {sent ? (
        <div className="flex flex-col gap-4 text-sm">
          <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-3 text-foreground">
            Si el email existe en SpAIder, te hemos enviado un enlace para
            restablecer la contraseña. Revisa tu bandeja (y el spam).
          </p>
          <Link href="/login" className="text-center text-sm text-foreground hover:underline">
            Volver al login
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <p className="text-sm text-muted-foreground">
            Introduce tu email y te enviaremos un enlace para restablecer tu
            contraseña.
          </p>
          <div className="space-y-1.5">
            <label htmlFor="fp-email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="fp-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="tu@email.com"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar enlace
          </button>
          <Link href="/login" className="block text-center text-xs text-muted-foreground hover:text-foreground">
            Volver al login
          </Link>
        </form>
      )}
    </div>
  );
}
