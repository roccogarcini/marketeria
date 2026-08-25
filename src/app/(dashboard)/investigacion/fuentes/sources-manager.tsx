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
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
  Sparkles,
  Globe,
  Pencil,
  Telescope,
  Newspaper,
} from "lucide-react";
import {
  PLATFORM_LIST,
  PLATFORMS,
  type Platform,
  type FilterValue,
} from "@/lib/apify/platforms";
import {
  ApifyFiltersForm,
  defaultFiltersFor,
} from "@/components/research/apify-filters-form";

type Source = {
  id: string;
  name: string;
  type: string;
  url: string | null;
  platform: string | null;
  isActive: boolean;
  lastFetchedAt: string | null;
  findingsCount: number;
};

/**
 * Tipos visibles en el formulario de creación. Mismo patrón que en
 * Automatizaciones: cuatro botones grandes, cada uno con un comportamiento
 * claramente distinto y formulario específico debajo. El tipo "YOUTUBE"
 * (Data API) no tiene UI de alta: funciona, pero la recomendación es usar
 * Apify con plataforma=YouTube.
 */
type Kind = "AI_RESEARCH" | "APIFY" | "WEB" | "WORDPRESS";

const KIND_META: Record<
  Kind,
  { label: string; icon: typeof Sparkles; help: string }
> = {
  AI_RESEARCH: {
    label: "Investigación IA",
    icon: Telescope,
    help: "Escribe un brief en lenguaje natural y la IA busca en la web hallazgos reales.",
  },
  APIFY: {
    label: "Apify",
    icon: Sparkles,
    help: "Scrapea redes: Instagram, TikTok, YouTube, Facebook, LinkedIn, X.",
  },
  WEB: {
    label: "Web (RSS o URL)",
    icon: Globe,
    help: "Apunta a un feed RSS o a una URL concreta. Al refrescar, trae lo nuevo del sitio.",
  },
  WORDPRESS: {
    label: "WordPress",
    icon: Newspaper,
    help: "Lee las entradas por la API del propio WordPress: cuerpo completo, autor y fecha reales.",
  },
};

/**
 * Mapea cada Source en BD a la etiqueta humana del listado.
 * Las sources YOUTUBE se etiquetan como Apify (es el mismo concepto).
 */
function labelFor(s: Source): string {
  if (s.type === "AI_RESEARCH") return KIND_META.AI_RESEARCH.label;
  if (s.type === "APIFY") return KIND_META.APIFY.label;
  if (s.type === "URL" || s.type === "RSS") return KIND_META.WEB.label;
  if (s.type === "WORDPRESS") return KIND_META.WORDPRESS.label;
  if (s.type === "MANUAL") return "Manual (legacy)";
  if (s.type === "YOUTUBE") return "YouTube (Data API)";
  return s.type;
}

const RSSHUB_BASE = "https://rsshub.app";
const RSSHUB_EXAMPLES: { label: string; template: string; hint: string }[] = [
  { label: "Twitter user", template: "/twitter/user/{{v}}", hint: "@usuario o usuario" },
  { label: "YouTube channel", template: "/youtube/channel/{{v}}", hint: "ID del canal (UCxxxx)" },
  { label: "Instagram user", template: "/instagram/user/{{v}}", hint: "usuario" },
  { label: "GitHub repo releases", template: "/github/release/{{v}}", hint: "owner/repo" },
  { label: "Medium user", template: "/medium/user/{{v}}", hint: "@usuario" },
];

export function SourcesManager({ initial }: { initial: Source[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [fetchingId, setFetchingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    kind: "AI_RESEARCH" as Kind,
    name: "",
    isActive: true,
    // Apify
    platform: "INSTAGRAM" as Platform,
    query: "",
    maxItems: 30,
    actorId: "",
    filters: defaultFiltersFor("INSTAGRAM") as Record<string, FilterValue>,
    // Investigación IA
    brief: "",
    // Web
    webMode: "RSS" as "RSS" | "URL",
    url: "",
    // RSSHub helper
    rsshubTemplate: RSSHUB_EXAMPLES[0].template,
    rsshubValue: "",
    // WordPress
    wpPerPage: 10,
    wpSearch: "",
  });

  function resetForm() {
    setForm({
      kind: "AI_RESEARCH",
      name: "",
      isActive: true,
      platform: "INSTAGRAM",
      query: "",
      maxItems: 30,
      actorId: "",
      filters: defaultFiltersFor("INSTAGRAM"),
      brief: "",
      webMode: "RSS",
      url: "",
      rsshubTemplate: RSSHUB_EXAMPLES[0].template,
      rsshubValue: "",
      wpPerPage: 10,
      wpSearch: "",
    });
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("Pon un nombre a la fuente.");
      return;
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      isActive: form.isActive,
    };

    if (form.kind === "AI_RESEARCH") {
      if (!form.brief.trim()) {
        setError("Escribe el brief: qué quieres que investigue la IA.");
        return;
      }
      body.type = "AI_RESEARCH";
      body.configJson = JSON.stringify({ brief: form.brief.trim() });
    } else if (form.kind === "APIFY") {
      if (!form.query.trim()) {
        setError("Escribe la query (hashtags, keywords o URLs).");
        return;
      }
      body.type = "APIFY";
      body.platform = form.platform;
      body.configJson = JSON.stringify({
        query: form.query.trim(),
        maxItems: form.maxItems,
        ...(form.actorId.trim() ? { actorId: form.actorId.trim() } : {}),
        filters: form.filters,
      });
    } else if (form.kind === "WEB") {
      if (!form.url.trim()) {
        setError("Pega la URL del sitio o feed.");
        return;
      }
      body.type = form.webMode; // "RSS" o "URL"
      body.url = form.url.trim();
    } else if (form.kind === "WORDPRESS") {
      if (!form.url.trim()) {
        setError("Pega la dirección del sitio WordPress (la raíz, no una entrada).");
        return;
      }
      body.type = "WORDPRESS";
      body.url = form.url.trim();
      body.configJson = JSON.stringify({
        perPage: form.wpPerPage,
        ...(form.wpSearch.trim() ? { search: form.wpSearch.trim() } : {}),
      });
    }

    const res = await fetch("/api/sources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Error creando la fuente");
      return;
    }
    resetForm();
    setCreating(false);
    startTransition(() => router.refresh());
  }

  async function runFetch(id: string) {
    setFetchingId(id);
    setMessage(null);
    setError(null);
    const res = await fetch(`/api/sources/${id}/fetch`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setFetchingId(null);
    if (!res.ok) {
      setError(data.error ?? "Error en fetch");
      return;
    }
    setMessage(
      data.error
        ? `Refresco parcial: ${data.error}`
        : `Refresco completado · ${data.created} nuevos, ${data.skipped} duplicados.`,
    );
    startTransition(() => router.refresh());
  }

  async function remove(id: string) {
    if (
      !confirm(
        "¿Eliminar esta fuente? Se borran también todos sus hallazgos.",
      )
    )
      return;
    const res = await fetch(`/api/sources/${id}`, { method: "DELETE" });
    if (!res.ok) return;
    startTransition(() => router.refresh());
  }

  const KindButton = ({ k }: { k: Kind }) => {
    const meta = KIND_META[k];
    const Icon = meta.icon;
    const selected = form.kind === k;
    return (
      <button
        type="button"
        onClick={() => setForm({ ...form, kind: k })}
        className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition ${
          selected
            ? "border-primary/60 bg-primary/[0.07]"
            : "border-border/40 hover:border-border/70"
        }`}
      >
        <div className="flex items-center gap-2">
          <Icon
            className={`h-4 w-4 ${selected ? "text-foreground" : "text-muted-foreground"}`}
          />
          <span className="text-sm font-semibold">{meta.label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">{meta.help}</p>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="display-md">Fuentes</h1>
          <p className="text-sm text-muted-foreground">
            Cada fuente alimenta la bandeja de hallazgos. La refrescas a mano o
            la programas desde <strong>Automatizaciones</strong>.
          </p>
        </div>
        <Button
          onClick={() => {
            setCreating((v) => !v);
            if (!creating) resetForm();
          }}
        >
          <Plus className="h-4 w-4" /> Nueva fuente
        </Button>
      </header>

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

      {creating && (
        <form onSubmit={onCreate} className="glass-card grid gap-4 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label>¿Con qué motor investigar?</Label>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <KindButton k="AI_RESEARCH" />
                <KindButton k="APIFY" />
                <KindButton k="WEB" />
                <KindButton k="WORDPRESS" />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label htmlFor="s-name">Nombre</Label>
              <Input
                id="s-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ej. Instagram · claudecode · semanal"
              />
            </div>

            {/* INVESTIGACIÓN IA */}
            {form.kind === "AI_RESEARCH" && (
              <div className="flex flex-col gap-1.5 md:col-span-2">
                <Label htmlFor="s-brief">¿Qué quieres que investigue?</Label>
                <Textarea
                  id="s-brief"
                  rows={5}
                  required
                  value={form.brief}
                  onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  placeholder={`Ejemplo:\nNovedades de las últimas 2 semanas sobre "MCPs verticales en banca".\nPrioriza casos con métricas reales y enlaces a documentación. Límite: 8 hallazgos.`}
                />
                <p className="text-[11px] text-muted-foreground">
                  La IA busca en la web (con tu proveedor LLM; si no tiene
                  búsqueda nativa, usa <span className="font-medium">Tavily</span>)
                  y crea hallazgos reales con su URL. Cada refresco repite la búsqueda.
                </p>
              </div>
            )}

            {/* APIFY */}
            {form.kind === "APIFY" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-platform">Plataforma</Label>
                  <Select
                    value={form.platform}
                    onValueChange={(v) => {
                      const next = v as Platform;
                      setForm({
                        ...form,
                        platform: next,
                        filters: defaultFiltersFor(next),
                      });
                    }}
                  >
                    <SelectTrigger id="s-platform" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PLATFORM_LIST.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PLATFORMS[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-max">Máx items</Label>
                  <Input
                    id="s-max"
                    type="number"
                    min={1}
                    max={100}
                    value={form.maxItems}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        maxItems: Math.max(
                          1,
                          Math.min(100, Number(e.target.value) || 30),
                        ),
                      })
                    }
                  />
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="s-query">
                    Qué buscar{" "}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      {PLATFORMS[form.platform].queryHint}
                    </span>
                  </Label>
                  <Textarea
                    id="s-query"
                    rows={2}
                    required
                    value={form.query}
                    onChange={(e) => setForm({ ...form, query: e.target.value })}
                    placeholder={PLATFORMS[form.platform].queryHint}
                  />
                </div>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="s-actor">
                    Actor ID{" "}
                    <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                      (opcional — vacío usa el actor por defecto)
                    </span>
                  </Label>
                  <Input
                    id="s-actor"
                    value={form.actorId}
                    onChange={(e) =>
                      setForm({ ...form, actorId: e.target.value })
                    }
                    placeholder={PLATFORMS[form.platform].defaultActorId}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="md:col-span-2">
                  <ApifyFiltersForm
                    platform={form.platform}
                    value={form.filters}
                    onChange={(filters) => setForm({ ...form, filters })}
                  />
                </div>
              </>
            )}

            {/* WORDPRESS */}
            {form.kind === "WORDPRESS" && (
              <>
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <Label htmlFor="s-wp-url">Dirección del sitio</Label>
                  <Input
                    id="s-wp-url"
                    type="url"
                    required
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://miblog.com"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    La raíz del sitio, no una entrada concreta. Leemos{" "}
                    <span className="font-mono">/wp-json/wp/v2/posts</span>, que
                    casi todos los WordPress publican sin necesidad de clave.
                    Si el sitio la tiene cerrada, el refresco te lo dirá.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-wp-per-page">Entradas por refresco</Label>
                  <Input
                    id="s-wp-per-page"
                    type="number"
                    min={1}
                    max={100}
                    value={form.wpPerPage}
                    onChange={(e) =>
                      setForm({ ...form, wpPerPage: Number(e.target.value) })
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    De la más reciente hacia atrás. Las repetidas no se duplican.
                  </p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-wp-search">Filtrar por texto (opcional)</Label>
                  <Input
                    id="s-wp-search"
                    value={form.wpSearch}
                    onChange={(e) => setForm({ ...form, wpSearch: e.target.value })}
                    placeholder="Ej. campaña"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Se lo pasamos al buscador del propio WordPress. En blanco,
                    trae todas.
                  </p>
                </div>
              </>
            )}

            {/* WEB (RSS o URL) */}
            {form.kind === "WEB" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-webmode">Tipo de web</Label>
                  <Select
                    value={form.webMode}
                    onValueChange={(v) =>
                      setForm({ ...form, webMode: v as "RSS" | "URL" })
                    }
                  >
                    <SelectTrigger id="s-webmode" className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RSS">Feed RSS</SelectItem>
                      <SelectItem value="URL">URL concreta (HTML)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="s-url">URL</Label>
                  <Input
                    id="s-url"
                    type="url"
                    required
                    value={form.url}
                    onChange={(e) => setForm({ ...form, url: e.target.value })}
                    placeholder="https://…"
                  />
                </div>
                {form.webMode === "RSS" && (
                  <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/30 p-3 md:col-span-2">
                    <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Helper RSSHub
                      <a
                        href="https://docs.rsshub.app/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-[10px] font-normal text-foreground/80 hover:text-foreground"
                      >
                        docs.rsshub.app ↗
                      </a>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Si la red/servicio no tiene RSS oficial, elige plantilla y
                      pega el identificador; construimos la URL con una instancia
                      pública de RSSHub.
                    </p>
                    <div className="grid gap-2 md:grid-cols-3">
                      <Select
                        value={form.rsshubTemplate}
                        onValueChange={(v) =>
                          setForm({ ...form, rsshubTemplate: v })
                        }
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RSSHUB_EXAMPLES.map((e) => (
                            <SelectItem key={e.template} value={e.template}>
                              {e.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={form.rsshubValue}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            rsshubValue: e.target.value.replace(/^@/, "").trim(),
                          })
                        }
                        placeholder={
                          RSSHUB_EXAMPLES.find(
                            (e) => e.template === form.rsshubTemplate,
                          )?.hint
                        }
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!form.rsshubValue}
                        onClick={() => {
                          const built =
                            RSSHUB_BASE +
                            form.rsshubTemplate.replace(
                              "{{v}}",
                              encodeURIComponent(form.rsshubValue),
                            );
                          setForm({ ...form, url: built });
                        }}
                      >
                        Generar URL
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            <div className="md:col-span-2 flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCreating(false);
                  resetForm();
                }}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />} Crear
              </Button>
            </div>
          </div>
        </form>
      )}

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase tracking-widest text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-left">Motor</th>
              <th className="px-3 py-2 text-left">Detalle</th>
              <th className="px-3 py-2 text-left">Hallazgos</th>
              <th className="px-3 py-2 text-left">Último refresco</th>
              <th className="px-3 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-muted-foreground"
                >
                  Sin fuentes todavía. Crea la primera.
                </td>
              </tr>
            )}
            {initial.map((s) => (
              <tr key={s.id} className="border-t border-border/40">
                <td className="px-3 py-2">{s.name}</td>
                <td className="px-3 py-2">
                  <Badge variant="outline">{labelFor(s)}</Badge>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground truncate max-w-xs">
                  {s.url ?? s.platform ?? "—"}
                </td>
                <td className="px-3 py-2">{s.findingsCount}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {s.lastFetchedAt
                    ? new Date(s.lastFetchedAt).toLocaleString("es-ES")
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  {s.type !== "MANUAL" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => runFetch(s.id)}
                      disabled={fetchingId === s.id}
                      aria-label="Refrescar"
                      title="Refrescar ahora"
                    >
                      {fetchingId === s.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => remove(s.id)}
                    aria-label="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
