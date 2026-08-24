"use client";

import { useEffect } from "react";
import { signOut } from "next-auth/react";
import { Loader2 } from "lucide-react";

export default function LogoutPage() {
  useEffect(() => {
    signOut({ callbackUrl: "/login" });
  }, []);

  return (
    <div className="glass-card flex w-full max-w-sm flex-col items-center gap-3 p-8 text-center">
      <Loader2 className="h-6 w-6 animate-spin text-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">Cerrando sesión…</p>
    </div>
  );
}
