"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Sparkles, Undo2 } from "lucide-react";

type Props = {
  findingId: string;
  status: string;
};

export function FindingActions({ findingId, status }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<"mark" | "unmark" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "NEW" | "SENT_TO_ANALYSIS" | "DISCARDED") {
    setError(null);
    const res = await fetch(`/api/findings/${findingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al actualizar");
      setBusy(null);
      return false;
    }
    return true;
  }

  async function markInteresting() {
    setBusy("mark");
    const ok = await setStatus("SENT_TO_ANALYSIS");
    setBusy(null);
    if (ok) startTransition(() => router.refresh());
  }

  async function unmark() {
    setBusy("unmark");
    const ok = await setStatus("NEW");
    setBusy(null);
    if (ok) startTransition(() => router.refresh());
  }

  async function approveAsIdea() {
    setBusy("approve");
    setError(null);
    const res = await fetch(`/api/findings/${findingId}/promote-to-idea`, {
      method: "POST",
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error al aprobar como idea");
      return;
    }
    const data = await res.json();
    router.push(`/ideas/${data.idea.id}`);
  }

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {status !== "PROMOTED" && (
          <Button
            onClick={approveAsIdea}
            disabled={busy !== null || pending}
            className="gap-1.5"
          >
            {busy === "approve" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Aprobar como idea
          </Button>
        )}
        {status === "NEW" && (
          <Button
            variant="outline"
            onClick={markInteresting}
            disabled={busy !== null || pending}
            className="gap-1.5"
          >
            {busy === "mark" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Marcar como interesante
          </Button>
        )}
        {status === "SENT_TO_ANALYSIS" && (
          <Button
            variant="outline"
            onClick={unmark}
            disabled={busy !== null || pending}
            className="gap-1.5"
          >
            {busy === "unmark" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Undo2 className="h-4 w-4" />
            )}
            Quitar de interesantes
          </Button>
        )}
        {status === "PROMOTED" && (
          <span className="text-sm text-foreground">
            ✓ Ya promocionada a idea aprobada
          </span>
        )}
      </div>
    </div>
  );
}
