import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireRole } from "@/lib/auth/rbac";
import { prisma } from "@/lib/prisma";
import { parseCarouselFiles } from "@/lib/carousel/parse";
import { withRenderBrowser, RenderBusyError } from "@/lib/render/browser-pool";
import type { Page } from "puppeteer";

/** El pool trabaja con un tipo mínimo de navegador; aquí recuperamos el real. */
type PuppeteerPage = Page;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Renderizar todos los slides con Puppeteer puede tardar varios segundos por
// asset; ampliamos el límite por defecto de Vercel/Next.
export const maxDuration = 120;

const SLIDE_DIMENSION = 1080;
const DEVICE_SCALE_FACTOR = 2;
const SCREENSHOT_TIMEOUT_MS = 25_000;

/**
 * GET /api/assets/[id]/export-png
 *
 * Renderiza los slides HTML del asset carrusel a PNG 1080×1080 (deviceScaleFactor 2)
 * con Puppeteer headless y devuelve un ZIP con todos los slides + copy.md +
 * convert.js si vienen incluidos en el body. Diseñado para canales CAROUSEL.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireRole("editor");
  if (guard instanceof NextResponse) return guard;

  const { id } = await params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      channel: { select: { type: true, name: true } },
      content: { select: { title: true } },
    },
  });
  if (!asset) {
    return NextResponse.json({ error: "Asset no encontrado" }, { status: 404 });
  }
  // Se exporta por CONTENIDO, no por tipo de canal: si el body contiene
  // slides HTML (p. ej. canal Instagram con agente carrusel), se renderiza.
  // El check de abajo (slides.length === 0) cubre los assets sin slides.
  const files = parseCarouselFiles(asset.body);
  const slides = files.filter((f) => f.name.toLowerCase().endsWith(".html"));
  if (slides.length === 0) {
    return NextResponse.json(
      {
        error:
          "El asset no contiene slides HTML reconocibles. Revisa la salida cruda.",
      },
      { status: 422 },
    );
  }

  // Los slides son HTML de terceros (LLM o API externa): bloqueamos toda la
  // red del navegador salvo recursos inline y las webfonts de Google (que los
  // slides legacy referencian). Sin esto, un slide malicioso podría hacer SSRF
  // contra la red interna o exfiltrar datos desde el contenedor.
  const ALLOWED_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
  function isAllowedRequest(url: string): boolean {
    if (/^(data|about|blob):/i.test(url)) return true;
    try {
      return ALLOWED_HOSTS.has(new URL(url).hostname);
    } catch {
      return false;
    }
  }

  const zip = new JSZip();
  // Chromium compartido y con tope de renderizados simultáneos: un navegador
  // por petición (~200 MB) agota la memoria en cuanto coinciden tres o cuatro
  // exportaciones, y eso tumba la app entera.
  try {
    await withRenderBrowser(async (browser) => {
      for (const slide of slides) {
        const page = (await browser.newPage()) as unknown as PuppeteerPage;
        try {
          await page.setRequestInterception(true);
          page.on("request", (req) => {
            if (isAllowedRequest(req.url())) void req.continue();
            else void req.abort();
          });
          await page.setViewport({
            width: SLIDE_DIMENSION,
            height: SLIDE_DIMENSION,
            deviceScaleFactor: DEVICE_SCALE_FACTOR,
          });
          await page.setContent(slide.content, {
            waitUntil: "load",
            timeout: SCREENSHOT_TIMEOUT_MS,
          });
          // Esperamos a que las webfonts de Google (Inter weight 400/700/900)
          // estén disponibles; sin esto, los titulares caen al fallback del sistema.
          await page.evaluate(async () => {
            if (document.fonts && document.fonts.ready) {
              await document.fonts.ready;
            }
            // Un frame extra para que gradientes/blur/backdrop-filter aplicados
            // por el compositor terminen de pintarse antes del screenshot.
            await new Promise<void>((r) => requestAnimationFrame(() => r()));
          });
          const png = await page.screenshot({
            type: "png",
            omitBackground: false,
            clip: {
              x: 0,
              y: 0,
              width: SLIDE_DIMENSION,
              height: SLIDE_DIMENSION,
            },
          });
          const pngName = slide.name.replace(/\.html$/i, ".png");
          zip.file(pngName, png);
        } finally {
          // Cerramos SIEMPRE la pestaña: el navegador es compartido, una
          // pestaña huérfana se queda ocupando memoria para siempre.
          await page.close().catch(() => {});
        }
      }
    });
  } catch (err) {
    if (err instanceof RenderBusyError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }

  // Incluimos los recursos no-HTML (copy.md, convert.js) tal cual, para que el
  // ZIP descargado sea autocontenido como bundle de publicación.
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".html")) {
      zip.file(f.name, f.content);
    }
  }

  // DEFLATE + uint8array: produce ZIPs estándar que Archive Utility de macOS,
  // Explorer de Windows y unzip leen sin protestar. Con `store` (default de
  // JSZip) algunos descompresores GUI fallan al toparse con la combinación
  // chunked-transfer + compression:0.
  const zipBytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const safeTitle = (asset.content?.title ?? "carrusel")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60) || "carrusel";

  // Devolvemos longitud explícita para que el navegador conozca el tamaño y
  // pueda marcar la descarga como completa sin depender de chunked transfer
  // (evita ZIPs truncados o "incompatibles" en Archive Utility de macOS).
  // Pasamos los bytes envueltos en un Blob: garantiza un Content-Type estable
  // y una longitud determinista que Next.js no transforma.
  // El cast a Uint8Array<ArrayBuffer> es para satisfacer al strict typing de
  // BlobPart en TS 5.7 — JSZip declara `ArrayBufferLike` (incluye SharedArrayBuffer)
  // pero en runtime nunca devuelve uno compartido.
  const blob = new Blob([zipBytes as Uint8Array<ArrayBuffer>], {
    type: "application/zip",
  });
  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeTitle}-png.zip"`,
      "Content-Length": String(zipBytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
