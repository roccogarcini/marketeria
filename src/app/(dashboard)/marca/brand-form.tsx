"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Trash2, Plus } from "lucide-react";

type Initial = {
  name: string;
  tone: string;
  voice: string;
  audience: string;
  editorialLines: string[];
  mustAvoid: string;
  visualIdentity: string;
  logoDataUri: string;
};

// ~200KB de imagen. El backend valida además tipo (png/jpeg/webp) y tamaño.
const MAX_LOGO_BYTES = 200 * 1024;

export function BrandForm({ initial }: { initial: Initial | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<Initial>(
    initial ?? {
      name: "",
      tone: "",
      voice: "",
      audience: "",
      editorialLines: [],
      mustAvoid: "",
      visualIdentity: "",
      logoDataUri: "",
    },
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const res = await fetch("/api/brand", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        tone: form.tone || null,
        voice: form.voice || null,
        audience: form.audience || null,
        editorialLines: form.editorialLines.filter(Boolean),
        mustAvoid: form.mustAvoid || null,
        visualIdentity: form.visualIdentity || null,
        logoDataUri: form.logoDataUri || null,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error guardando");
      return;
    }
    setMessage("Perfil de marca guardado.");
    startTransition(() => router.refresh());
  }

  // Sube el logo como data URI (png/jpeg/webp, ≤200KB). Se guarda con el
  // resto del perfil al pulsar Guardar.
  function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setError("El logo debe ser PNG, JPEG o WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError(
        `El logo pesa ${Math.round(file.size / 1024)}KB — máximo 200KB. Usa una versión pequeña tipo favicon (p. ej. 256×256).`,
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setForm((f) => ({ ...f, logoDataUri: reader.result as string }));
        setMessage("Logo cargado. Recuerda pulsar «Guardar perfil».");
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <header>
        <h1 className="display-md">Perfil de marca</h1>
        <p className="text-sm text-muted-foreground">
          Singleton editorial. Define tono, voz, audiencia y líneas. Aplica a toda la producción IA.
        </p>
      </header>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-foreground">
          {message}
        </div>
      )}

      <div className="glass-card grid gap-4 p-5 md:grid-cols-2">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="b-name">Nombre de marca</Label>
          <Input id="b-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="b-tone">Tono</Label>
          <Textarea id="b-tone" rows={3} value={form.tone} onChange={(e) => setForm({ ...form, tone: e.target.value })} placeholder="Cercano, directo, optimista…" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="b-voice">Voz</Label>
          <Textarea id="b-voice" rows={3} value={form.voice} onChange={(e) => setForm({ ...form, voice: e.target.value })} placeholder="Primera persona plural, ejemplos concretos…" />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="b-aud">Audiencia</Label>
          <Textarea id="b-aud" rows={2} value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} placeholder="Equipos de marketing B2B, gerencia, etc." />
        </div>

        <div className="flex flex-col gap-2 md:col-span-2">
          <Label>Líneas editoriales</Label>
          {form.editorialLines.map((line, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={line}
                onChange={(e) =>
                  setForm({
                    ...form,
                    editorialLines: form.editorialLines.map((l, i) => (i === idx ? e.target.value : l)),
                  })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setForm({ ...form, editorialLines: form.editorialLines.filter((_, i) => i !== idx) })}
                aria-label="Eliminar"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm({ ...form, editorialLines: [...form.editorialLines, ""] })}
          >
            <Plus className="h-4 w-4" /> Añadir línea
          </Button>
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="b-avoid">Qué evitar</Label>
          <Textarea id="b-avoid" rows={3} value={form.mustAvoid} onChange={(e) => setForm({ ...form, mustAvoid: e.target.value })} placeholder="Jerga excesiva, afirmaciones absolutas…" />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <Label htmlFor="b-visual" className="flex flex-col gap-0.5">
            <span>Identidad visual</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              Colores (hex), tipografía/estilo, handle y firma. Se aplica al
              DISEÑO de las creaciones (carruseles, adaptaciones a canal).
            </span>
          </Label>
          <Textarea
            id="b-visual"
            rows={4}
            value={form.visualIdentity}
            onChange={(e) => setForm({ ...form, visualIdentity: e.target.value })}
            placeholder={"Ej: Fondo #0E0E12, acento #6EE7B7, texto #FFFFFF. Estilo minimalista, tipografía sans gruesa. Firma @mimarca en el slide final."}
          />
        </div>

        <div className="flex flex-col gap-2 md:col-span-2">
          <Label htmlFor="b-logo" className="flex flex-col gap-0.5">
            <span>Logo (tipo favicon)</span>
            <span className="text-[10px] font-normal text-muted-foreground">
              PNG/JPEG/WebP, máx 200KB (ideal 256×256 con fondo transparente).
              Queda DISPONIBLE para los diseños, pero solo se usa si lo pides:
              en las correcciones al regenerar («incluye el logo»), en las
              reglas del canal o en la identidad visual.
            </span>
          </Label>
          <div className="flex flex-wrap items-center gap-3">
            {form.logoDataUri ? (
              <span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-background/40 p-1">
                {/* data URI local — next/image no aporta aquí */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={form.logoDataUri}
                  alt="Logo de la marca"
                  className="max-h-full max-w-full object-contain"
                />
              </span>
            ) : (
              <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-border/60 text-[10px] text-muted-foreground">
                Sin logo
              </span>
            )}
            <input
              id="b-logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={onLogoFile}
              className="text-xs file:mr-3 file:rounded-md file:border file:border-input file:bg-transparent file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-accent/40"
            />
            {form.logoDataUri && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setForm({ ...form, logoDataUri: "" })}
              >
                <Trash2 className="h-3.5 w-3.5" /> Quitar logo
              </Button>
            )}
          </div>
        </div>
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar perfil
        </Button>
      </div>
    </form>
  );
}
