"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Copy,
  Check,
  FileCode,
  Files,
  Image as ImageIcon,
  Loader2,
  Minus,
  MessageCircle,
  Plus,
  RotateCcw,
} from "lucide-react";
import { parseCarouselFiles } from "@/lib/carousel/parse";

function downloadFile(name: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.25;

type CarouselPreviewProps = {
  body: string;
  /**
   * Opcional. Si se pasa, habilita la descarga server-side de PNGs renderizados
   * con Puppeteer desde /api/assets/[id]/export-png. Sin assetId, el botón no
   * aparece (modo "preview suelto").
   */
  assetId?: string;
};

export function CarouselPreview({ body, assetId }: CarouselPreviewProps) {
  const files = useMemo(() => parseCarouselFiles(body), [body]);
  const slides = files.filter((f) => f.name.toLowerCase().endsWith(".html"));
  const others = files.filter((f) => !f.name.toLowerCase().endsWith(".html"));
  const copy = others.find(
    (f) => f.name === "copy.md" || f.name.toLowerCase() === "copy.md",
  );
  const convert = others.find(
    (f) =>
      f.name === "convert.js" || f.name.toLowerCase() === "convert.js",
  );

  // Si hay bundle.md (fallback cuando no se detectaron slides), lo tratamos
  // como la "copy" a mostrar para que el usuario vea algo en lugar de vacío.
  const bundle = others.find((f) => f.name.toLowerCase() === "bundle.md");

  const [idx, setIdx] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);
  const [tab, setTab] = useState<"slides" | "copy" | "convert" | "raw">(
    slides.length > 0 ? "slides" : bundle ? "raw" : "slides",
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Escalado proporcional del iframe 1080×1080 al ancho disponible, para que
  // la imagen nunca se recorte por mucho que estreche la ventana.
  const slideStageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  // Zoom manual del usuario (1 = 100%). null = modo "fit-to-width" — el slide
  // ocupa el ancho del contenedor. Cualquier interacción con slider/botones
  // pasa a modo manual y respeta el porcentaje elegido.
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const [exportingPng, setExportingPng] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    const el = slideStageRef.current;
    if (!el) return;
    const recalc = () => {
      const w = el.clientWidth;
      if (w > 0) setFitScale(w / 1080);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    window.addEventListener("resize", recalc);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [tab, idx]);

  useEffect(() => {
    // Reset al cambiar body
    setIdx(0);
    setManualZoom(null);
    setExportError(null);
  }, [body]);

  // Zoom efectivo aplicado al iframe. En modo fit usamos el escalado calculado
  // a partir del ancho del contenedor; en modo manual respetamos el porcentaje
  // que ha elegido el usuario (el iframe puede salirse → el stage hace scroll).
  const effectiveScale = manualZoom ?? fitScale;
  const isManual = manualZoom !== null;
  const zoomPct = Math.round(effectiveScale * 100);

  function applyZoom(next: number) {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setManualZoom(Number(clamped.toFixed(2)));
  }
  function resetZoom() {
    setManualZoom(null);
  }

  function go(dir: -1 | 1) {
    setIdx((v) => {
      const n = slides.length;
      if (n === 0) return 0;
      return (v + dir + n) % n;
    });
  }

  async function copyText(content: string, key: string) {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(key);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      /* ignore */
    }
  }

  function openFullscreen() {
    const el = iframeRef.current;
    if (!el) return;
    if (el.requestFullscreen) el.requestFullscreen();
  }

  function downloadAll() {
    files.forEach((f) => {
      const mime = f.name.endsWith(".html")
        ? "text/html"
        : f.name.endsWith(".js")
          ? "application/javascript"
          : "text/plain";
      downloadFile(f.name, f.content, mime);
    });
  }

  async function downloadPngs() {
    if (!assetId || exportingPng) return;
    setExportError(null);
    setExportingPng(true);
    try {
      // Hacemos UN solo request y leemos el body como ArrayBuffer crudo.
      // Reconstruimos el Blob con el tipo MIME explícito — evita el problema
      // observado en macOS donde el binario obtenido vía `res.blob()` se
      // entrega a Archive Utility con metadatos que considera "formato
      // incompatible" pese a que `unzip`/`ditto` lo abren sin pestañear.
      const res = await fetch(`/api/assets/${assetId}/export-png`);
      if (!res.ok) {
        const text = await res.text();
        let msg = "No se pudo generar el ZIP de PNGs.";
        try {
          msg = JSON.parse(text).error ?? msg;
        } catch {
          /* keep default */
        }
        throw new Error(msg);
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const filename = match?.[1] ?? "carrusel-png.zip";

      const bytes = await res.arrayBuffer();
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Liberamos el blob tras un tick para no romper la descarga en Safari.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Error desconocido.");
    } finally {
      setExportingPng(false);
    }
  }

  if (files.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/50 p-6 text-center text-sm text-muted-foreground">
        El asset todavía no tiene contenido para previsualizar.
      </div>
    );
  }

  const currentSlide = slides[idx];

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs superiores */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={tab === "slides" ? "default" : "outline"}
          size="sm"
          onClick={() => setTab("slides")}
          className="gap-1.5"
        >
          <Files className="h-3.5 w-3.5" />
          Slides ({slides.length})
        </Button>
        {copy && (
          <Button
            variant={tab === "copy" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("copy")}
            className="gap-1.5"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            Copy
          </Button>
        )}
        {convert && (
          <Button
            variant={tab === "convert" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("convert")}
            className="gap-1.5"
          >
            <FileCode className="h-3.5 w-3.5" />
            convert.js
          </Button>
        )}
        {bundle && (
          <Button
            variant={tab === "raw" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("raw")}
            className="gap-1.5"
            title="Salida cruda (formato no reconocido)"
          >
            <FileCode className="h-3.5 w-3.5" />
            Salida cruda
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {assetId && slides.length > 0 && (
            <Button
              variant="default"
              size="sm"
              onClick={downloadPngs}
              disabled={exportingPng}
              className="gap-1.5"
              title="Renderiza cada slide a PNG 1080×1080 con Puppeteer y descarga un ZIP"
            >
              {exportingPng ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5" />
              )}
              {exportingPng ? "Generando PNGs…" : `Descargar PNGs (${slides.length})`}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={downloadAll}
            className="gap-1.5"
          >
            <Download className="h-3.5 w-3.5" />
            Descargar HTML ({files.length} ficheros)
          </Button>
        </div>
      </div>

      {exportError && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {exportError}
        </div>
      )}

      {/* Tab slides: iframe renderer + navegación */}
      {tab === "slides" && slides.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="glass-card overflow-hidden p-3">
            {/* Header del slide actual */}
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tabular-nums">
                  {idx + 1} / {slides.length}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {currentSlide?.name}
                </span>
              </div>

              {/* Controles de zoom */}
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => applyZoom(effectiveScale - ZOOM_STEP)}
                  aria-label="Reducir zoom"
                  title="Reducir zoom"
                  disabled={effectiveScale <= MIN_ZOOM + 0.001}
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <Slider
                  value={[zoomPct]}
                  min={Math.round(MIN_ZOOM * 100)}
                  max={Math.round(MAX_ZOOM * 100)}
                  step={5}
                  onValueChange={(v) => applyZoom((v[0] ?? 100) / 100)}
                  aria-label="Zoom del slide"
                  className="w-32"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => applyZoom(effectiveScale + ZOOM_STEP)}
                  aria-label="Aumentar zoom"
                  title="Aumentar zoom"
                  disabled={effectiveScale >= MAX_ZOOM - 0.001}
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <span
                  className="min-w-[3.5rem] text-right font-mono text-[10px] text-muted-foreground tabular-nums"
                  title={isManual ? "Zoom manual" : "Ajustado al ancho"}
                >
                  {zoomPct}%{isManual ? "" : " · fit"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={resetZoom}
                  aria-label="Volver a ajuste automático"
                  title="Ajustar al ancho"
                  disabled={!isManual}
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    copyText(currentSlide?.content ?? "", currentSlide?.name ?? "")
                  }
                  aria-label="Copiar HTML"
                  title="Copiar HTML"
                >
                  {copied === currentSlide?.name ? (
                    <Check className="h-4 w-4 text-foreground" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    downloadFile(
                      currentSlide?.name ?? "slide.html",
                      currentSlide?.content ?? "",
                      "text/html",
                    )
                  }
                  aria-label="Descargar slide"
                  title="Descargar slide"
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={openFullscreen}
                  aria-label="Ver a pantalla completa"
                  title="Pantalla completa"
                >
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* iframe 1080x1080 con escala fit o manual */}
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => go(-1)}
                aria-label="Slide anterior"
                disabled={slides.length < 2}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div
                ref={slideStageRef}
                className={`relative flex-1 rounded-lg border border-border/40 bg-black ${
                  isManual ? "overflow-auto" : "overflow-hidden"
                }`}
                style={{
                  // En modo "fit" el stage tiene exactamente la altura que ocupa
                  // el iframe escalado (cuadrado al ancho disponible). En modo
                  // manual fijamos altura = ancho del contenedor para mantener
                  // proporción cuadrada y dejamos que el scroll muestre lo que
                  // se salga si el zoom es superior al 100% del ancho.
                  height: `${(isManual ? fitScale : effectiveScale) * 1080}px`,
                }}
              >
                <iframe
                  key={currentSlide?.name /* fuerza reload al cambiar */}
                  ref={iframeRef}
                  title={currentSlide?.name}
                  srcDoc={currentSlide?.content ?? ""}
                  // Sandbox total: los slides son HTML+CSS estático por diseño
                  // (y pueden venir de la API externa) — sin scripts ni
                  // same-origin en el navegador de quien los previsualiza.
                  sandbox=""
                  width={1080}
                  height={1080}
                  style={{
                    border: 0,
                    width: "1080px",
                    height: "1080px",
                    transform: `scale(${effectiveScale})`,
                    transformOrigin: "top left",
                    display: "block",
                  }}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => go(1)}
                aria-label="Slide siguiente"
                disabled={slides.length < 2}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Mini-pager con thumbs numéricos */}
            {slides.length > 1 && (
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {slides.map((s, i) => (
                  <button
                    key={s.name}
                    onClick={() => setIdx(i)}
                    aria-label={`Ir a slide ${i + 1}`}
                    className={`h-2 w-6 rounded-full transition ${
                      i === idx
                        ? "bg-primary"
                        : "bg-border/60 hover:bg-border"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab copy */}
      {tab === "copy" && copy && (
        <div className="glass-card flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {copy.name}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyText(copy.content, "copy")}
                aria-label="Copiar"
              >
                {copied === "copy" ? (
                  <Check className="h-4 w-4 text-foreground" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => downloadFile(copy.name, copy.content)}
                aria-label="Descargar"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <pre className="max-h-[400px] overflow-auto whitespace-pre-wrap rounded-md bg-background/40 p-3 text-xs leading-relaxed">
            {copy.content}
          </pre>
        </div>
      )}

      {/* Tab slides cuando no hay slides detectados: aviso */}
      {tab === "slides" && slides.length === 0 && (
        <div className="glass-card flex flex-col gap-3 p-6 text-sm">
          <p className="font-medium">
            No se han detectado slides en el formato esperado.
          </p>
          <p className="text-muted-foreground">
            El carrusel debe llegar con marcadores{" "}
            <code className="rounded bg-background/60 px-1 text-xs">
              === slideN.html ===
            </code>
            ,{" "}
            <code className="rounded bg-background/60 px-1 text-xs">
              &lt;!-- SLIDE N --&gt;
            </code>{" "}
            o cabeceras{" "}
            <code className="rounded bg-background/60 px-1 text-xs">
              ## Slide N
            </code>{" "}
            con un bloque{" "}
            <code className="rounded bg-background/60 px-1 text-xs">
              ```html
            </code>{" "}
            dentro.
          </p>
          {bundle && (
            <p className="text-muted-foreground">
              Abre la pestaña <strong>Salida cruda</strong> para ver lo que ha
              devuelto la IA, o regenera el asset con instrucciones más
              específicas.
            </p>
          )}
        </div>
      )}

      {/* Tab raw: bundle.md (salida no reconocida) */}
      {tab === "raw" && bundle && (
        <div className="glass-card flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {bundle.name} · salida completa
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyText(bundle.content, "raw")}
                aria-label="Copiar"
              >
                {copied === "raw" ? (
                  <Check className="h-4 w-4 text-foreground" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => downloadFile(bundle.name, bundle.content)}
                aria-label="Descargar"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <pre className="max-h-[600px] overflow-auto whitespace-pre-wrap rounded-md bg-background/40 p-3 text-xs leading-relaxed">
            {bundle.content}
          </pre>
        </div>
      )}

      {/* Tab convert.js */}
      {tab === "convert" && convert && (
        <div className="glass-card flex flex-col gap-2 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs text-muted-foreground">
              {convert.name}
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => copyText(convert.content, "convert")}
                aria-label="Copiar"
              >
                {copied === "convert" ? (
                  <Check className="h-4 w-4 text-foreground" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  downloadFile(convert.name, convert.content, "application/javascript")
                }
                aria-label="Descargar"
              >
                <Download className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <pre className="max-h-[500px] overflow-auto whitespace-pre rounded-md bg-background/40 p-3 font-mono text-xs leading-relaxed">
            {convert.content}
          </pre>
        </div>
      )}
    </div>
  );
}
