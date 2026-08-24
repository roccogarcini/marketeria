"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Search,
  Lightbulb,
  Share2,
  RotateCcw,
  GripHorizontal,
  Plus,
  Minus,
  Rss,
  Globe,
  PenLine,
  ExternalLink,
  Eye,
  type LucideIcon,
} from "lucide-react";
import { iconForChannelType } from "@/lib/channels/types";

function iconForSourceType(type: string): LucideIcon {
  const t = type.toUpperCase();
  if (t === "RSS") return Rss;
  if (t === "URL") return Globe;
  if (t === "MANUAL") return PenLine;
  return Search;
}

/**
 * SpiderDiagram — diagrama del pipeline en el dashboard.
 *
 * Cada entidad es una burbuja con SOLO el icono de su fuente/canal. Al hacer
 * hover aparece un popover con estilo corporativo mostrando título, resumen,
 * estado y un enlace a la ficha. Todas las entidades están representadas
 * (sin caps); el layout se adapta en grid dentro de las zonas izquierda
 * (findings), derecha (assets) y núcleo (ideas aprobadas).
 */

export type SpiderFinding = {
  id: string;
  title: string;
  sourceName: string;
  sourceType: string;
  status: string;
  snippet: string | null;
  publishedAt: string | null;
  url: string | null;
  reach: number | null;
  ideaId: string | null;
};
export type SpiderIdea = {
  id: string;
  title: string;
  angle: string | null;
  description: string | null;
  contentsCount: number;
  originFindingId?: string | null;
};
export type SpiderAsset = {
  id: string;
  channelName: string;
  channelType: string;
  status: string;
  contentTitle: string;
};
export type SpiderGroup = {
  id: string;
  title: string;
  ideaId: string;
  assets: SpiderAsset[];
};

// Lienzo
const W = 1400;
const H = 820;
const CORE = { x: W / 2, y: H / 2 };
const BODY_R = 220;
// Tamaño de burbuja. 22 = 44px de diámetro. Hasta ~16 filas cómodas.
const NODE_R = 22;

type NodeKind = "finding" | "asset" | "idea";
type Pos = { x: number; y: number };
type FlatAsset = {
  id: string;
  ideaId: string;
  channelName: string;
  channelType: string;
  status: string;
  contentTitle: string;
};

export function SpiderDiagram({
  findings,
  ideas,
  groups,
}: {
  findings: SpiderFinding[];
  ideas: SpiderIdea[];
  groups: SpiderGroup[];
  totals?: unknown;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState({ x: 0, y: 0 });
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hovered, setHovered] = useState<{ kind: NodeKind; id: string } | null>(
    null,
  );
  // Zoom & pan en el propio SVG. scale ∈ [0.4, 3]. tx/ty en coords de viewBox.
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const MIN_SCALE = 0.4;
  const MAX_SCALE = 3;
  const zoomAt = useCallback((sx: number, sy: number, factor: number) => {
    setView((v) => {
      const ns = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.scale * factor));
      if (ns === v.scale) return v;
      const ux = (sx - v.tx) / v.scale;
      const uy = (sy - v.ty) / v.scale;
      return { scale: ns, tx: sx - ux * ns, ty: sy - uy * ns };
    });
  }, []);
  const resetView = useCallback(() => {
    setView({ scale: 1, tx: 0, ty: 0 });
  }, []);

  // Assets aplanados (sólo aquellos cuya idea existe en el núcleo).
  const flatAssets = useMemo<FlatAsset[]>(() => {
    const ideaIds = new Set(ideas.map((i) => i.id));
    const list: FlatAsset[] = [];
    groups.forEach((g) => {
      if (!ideaIds.has(g.ideaId)) return;
      g.assets.forEach((a) => {
        list.push({
          id: a.id,
          ideaId: g.ideaId,
          channelName: a.channelName,
          channelType: a.channelType,
          status: a.status,
          contentTitle: a.contentTitle,
        });
      });
    });
    return list;
  }, [groups, ideas]);

  // ── Layout por defecto ────────────────────────────────────────────────
  const defaultPositions = useMemo(() => {
    const map: Record<string, Pos> = {};

    /**
     * Layout en columnas verticales que se apilan de delante (cerca del núcleo)
     * hacia atrás. Cada columna se estira al 100% del alto disponible.
     * - anchor="right": primera columna pegada al borde derecho; siguientes
     *   columnas van hacia la izquierda.
     * - anchor="left": primera columna pegada al borde izquierdo; siguientes
     *   columnas van hacia la derecha.
     */
    function placeStackedColumns(
      items: Array<{ id: string }>,
      kind: NodeKind,
      box: { x: number; y: number; w: number; h: number },
      anchor: "left" | "right",
    ) {
      const n = items.length;
      if (n === 0) return;
      const baseCellH = NODE_R * 2.4;
      const maxPerCol = Math.max(1, Math.floor(box.h / baseCellH));
      const cols = Math.max(1, Math.ceil(n / maxPerCol));
      const rowsFirstCol = Math.min(n, maxPerCol);
      // Estiramos la columna principal a todo el alto disponible.
      const cellH = box.h / rowsFirstCol;
      // El ancho de columna se aprieta si hacen falta más columnas de las que
      // caben: con separación fija, apilar hacia atrás se salía del lienzo por
      // los lados y las burbujas quedaban pegadas al borde del panel.
      const cellW = Math.min(NODE_R * 2.8, box.w / cols);
      items.forEach((item, i) => {
        const c = Math.floor(i / rowsFirstCol);
        const r = i % rowsFirstCol;
        const xInCol =
          anchor === "right"
            ? box.x + box.w - cellW / 2 - c * cellW
            : box.x + cellW / 2 + c * cellW;
        map[nodeKey(kind, item.id)] = {
          x: xInCol,
          y: box.y + cellH / 2 + r * cellH,
        };
      });
    }

    // FINDINGS (izquierda) — ordenados: primero los que tienen idea asociada
    // (van a la columna pegada al núcleo), luego el resto por detrás.
    const findingsOrdered = [...findings].sort((a, b) => {
      const aHas = a.ideaId ? 1 : 0;
      const bHas = b.ideaId ? 1 : 0;
      return bHas - aHas;
    });
    placeStackedColumns(
      findingsOrdered,
      "finding",
      { x: 80, y: 40, w: CORE.x - BODY_R - 140, h: H - 80 },
      "right",
    );
    // SOPORTES (derecha) — misma lógica, anchor a la izquierda (pegado al núcleo).
    placeStackedColumns(
      flatAssets,
      "asset",
      { x: CORE.x + BODY_R + 60, y: 40, w: CORE.x - BODY_R - 140, h: H - 80 },
      "left",
    );

    // Ideas dentro del núcleo. Se reparten en anillos SIMÉTRICOS: intentamos
    // meter todas en un único anillo con separación angular uniforme. Si no
    // caben (demasiadas), dividimos en anillos concéntricos con reparto
    // equitativo entre anillos.
    const n = ideas.length;
    if (n > 0) {
      const maxR = BODY_R - NODE_R - 10;
      const minGap = NODE_R * 3.2; // distancia entre centros en la circunferencia
      if (n === 1) {
        map[nodeKey("idea", ideas[0].id)] = { x: CORE.x, y: CORE.y };
      } else {
        // Capacidad de un anillo = floor(2πr / minGap). Buscamos el radio más
        // pequeño que fite todas; si supera maxR, repartimos entre anillos.
        const requiredR = (n * minGap) / (2 * Math.PI);
        if (requiredR <= maxR * 0.95) {
          // Cabe un solo anillo simétrico.
          const r = Math.max(NODE_R * 2.8, requiredR);
          for (let i = 0; i < n; i++) {
            const theta = (i / n) * 2 * Math.PI - Math.PI / 2;
            map[nodeKey("idea", ideas[i].id)] = {
              x: CORE.x + Math.cos(theta) * r,
              y: CORE.y + Math.sin(theta) * r,
            };
          }
        } else {
          // Caso extremo: reparto en 2+ anillos con capacidad proporcional.
          let placed = 0;
          let ring = 1;
          while (placed < n && ring <= 6) {
            const r = Math.min(maxR * 0.95, ring * (NODE_R * 3.4));
            const capacity = Math.max(1, Math.floor((2 * Math.PI * r) / minGap));
            const toPlace = Math.min(capacity, n - placed);
            for (let i = 0; i < toPlace; i++) {
              const theta =
                (i / toPlace) * 2 * Math.PI - Math.PI / 2 + ring * 0.25;
              map[nodeKey("idea", ideas[placed + i].id)] = {
                x: CORE.x + Math.cos(theta) * r,
                y: CORE.y + Math.sin(theta) * r,
              };
            }
            placed += toPlace;
            ring++;
          }
        }
      }
    }

    return map;
  }, [findings, flatAssets, ideas]);

  const [positions, setPositions] = useState<Record<string, Pos>>(() => ({
    ...defaultPositions,
  }));

  useEffect(() => {
    setPositions({ ...defaultPositions });
  }, [defaultPositions]);

  function resetLayout() {
    setPositions({ ...defaultPositions });
    resetView();
  }

  // Wheel zoom — listener nativo no-passive para poder preventDefault.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = pt.matrixTransform(ctm.inverse());
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      zoomAt(p.x, p.y, factor);
    };
    svg.addEventListener("wheel", handler, { passive: false });
    return () => svg.removeEventListener("wheel", handler);
  }, [zoomAt]);

  // ── Reduced motion + parallax del núcleo ─────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const el = hostRef.current;
    if (!el) return;
    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      setCursor({ x, y });
    };
    const onLeave = () => setCursor({ x: 0, y: 0 });
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [reducedMotion]);
  const coreShift = useMemo(
    () => (reducedMotion ? { x: 0, y: 0 } : { x: cursor.x * 6, y: cursor.y * 6 }),
    [reducedMotion, cursor.x, cursor.y],
  );

  // ── Drag ──────────────────────────────────────────────────────────────
  type DragState = {
    key: string;
    origin: Pos;
    startClient: { x: number; y: number };
    moved: boolean;
  };
  const dragRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef(false);
  // Pan del lienzo: arrastrar en espacio vacío actualiza view.tx/ty.
  const panRef = useRef<{
    startTx: number;
    startTy: number;
    startClient: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  const clientToSvg = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: cx, y: cy };
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: cx, y: cy };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  function onPointerDown(kind: NodeKind, id: string, ev: React.PointerEvent) {
    ev.stopPropagation();
    const key = nodeKey(kind, id);
    const origin = positions[key] ?? defaultPositions[key];
    if (!origin) return;
    try {
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = {
      key,
      origin: { ...origin },
      startClient: { x: ev.clientX, y: ev.clientY },
      moved: false,
    };
    justDraggedRef.current = false;
  }

  function onPointerMove(ev: React.PointerEvent) {
    const pan = panRef.current;
    if (pan) {
      const a = clientToSvg(pan.startClient.x, pan.startClient.y);
      const b = clientToSvg(ev.clientX, ev.clientY);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (!pan.moved && Math.hypot(dx, dy) > 4) {
        pan.moved = true;
        justDraggedRef.current = true;
        setHovered(null);
      }
      if (pan.moved) {
        setView((v) => ({ ...v, tx: pan.startTx + dx, ty: pan.startTy + dy }));
      }
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    const a = clientToSvg(d.startClient.x, d.startClient.y);
    const b = clientToSvg(ev.clientX, ev.clientY);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (!d.moved && dist > 4) {
      d.moved = true;
      justDraggedRef.current = true;
      setHovered(null);
    }
    if (d.moved) {
      // Compensamos el zoom del `<g>` interno para que el nodo siga al puntero
      // al arrastrar (si scale=2, un delta de 100px equivale a 50 uds internas).
      let nx = d.origin.x + dx / view.scale;
      let ny = d.origin.y + dy / view.scale;
      if (d.key.startsWith("idea:")) {
        const maxR = BODY_R - NODE_R - 4;
        const vx = nx - CORE.x;
        const vy = ny - CORE.y;
        const r = Math.hypot(vx, vy);
        if (r > maxR) {
          nx = CORE.x + (vx / r) * maxR;
          ny = CORE.y + (vy / r) * maxR;
        }
      } else {
        nx = clamp(nx, 60, W - 60);
        ny = clamp(ny, 60, H - 60);
      }
      setPositions((prev) => ({ ...prev, [d.key]: { x: nx, y: ny } }));
    }
  }

  function onPointerUp(ev: React.PointerEvent) {
    const d = dragRef.current;
    const pan = panRef.current;
    if (!d && !pan) return;
    try {
      (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
    panRef.current = null;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 30);
  }

  function onBgPointerDown(ev: React.PointerEvent) {
    // Solo disparamos pan si el evento se originó en el fondo (no en un nodo).
    if ((ev.target as Element).closest(".spider-node-link")) return;
    try {
      (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
    panRef.current = {
      startTx: view.tx,
      startTy: view.ty,
      startClient: { x: ev.clientX, y: ev.clientY },
      moved: false,
    };
  }

  function maybeBlockClick(ev: React.MouseEvent) {
    if (justDraggedRef.current) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  const posOf = useCallback(
    (kind: NodeKind, id: string): Pos =>
      positions[nodeKey(kind, id)] ?? defaultPositions[nodeKey(kind, id)] ?? CORE,
    [positions, defaultPositions],
  );

  function curveTo(from: Pos, to: Pos, direction: "left" | "right" = "left") {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const midX = from.x + dx * 0.5;
    const midY = from.y + dy * 0.5;
    const perpLen = Math.hypot(dx, dy) * 0.15;
    const nx = direction === "left" ? -Math.sign(dx || 1) : Math.sign(dx || 1);
    return `M ${from.x} ${from.y} Q ${midX + nx * perpLen} ${midY + perpLen * 0.6} ${to.x} ${to.y}`;
  }
  function strandOp(a: Pos, b: Pos) {
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    return Math.max(0.35, Math.min(0.85, 1 - d / 1800));
  }
  function trimSegment(a: Pos, b: Pos, rA: number, rB: number) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d < rA + rB + 2) return { a, b };
    const ux = dx / d;
    const uy = dy / d;
    return {
      a: { x: a.x + ux * rA, y: a.y + uy * rA },
      b: { x: b.x - ux * rB, y: b.y - uy * rB },
    };
  }
  function ideaAnchorFor(contentIdeaId: string): Pos {
    const idea = ideas.find((i) => i.id === contentIdeaId);
    if (idea) {
      const p = posOf("idea", idea.id);
      return { x: p.x + coreShift.x, y: p.y + coreShift.y };
    }
    return { x: CORE.x + coreShift.x, y: CORE.y + coreShift.y };
  }

  // ── Hover datos ──────────────────────────────────────────────────────
  const hoveredData = useMemo(() => {
    if (!hovered) return null;
    if (hovered.kind === "finding") {
      const f = findings.find((x) => x.id === hovered.id);
      if (!f) return null;
      return {
        kind: "finding" as const,
        title: f.title,
        subtitle: `${f.sourceName} · ${f.sourceType}`,
        body: f.snippet,
        status: f.status,
        href: `/investigacion/hallazgos/${f.id}`,
        externalHref: f.url,
        publishedAt: f.publishedAt,
        reach: f.reach,
        sourceType: f.sourceType,
      };
    }
    if (hovered.kind === "idea") {
      const i = ideas.find((x) => x.id === hovered.id);
      if (!i) return null;
      return {
        kind: "idea" as const,
        title: i.title,
        subtitle: i.angle ?? "",
        body: i.description,
        status: "APPROVED",
        href: `/ideas/${i.id}`,
        externalHref: null,
        publishedAt: null,
        reach: null,
        sourceType: "",
      };
    }
    // asset
    const a = flatAssets.find((x) => x.id === hovered.id);
    if (!a) return null;
    return {
      kind: "asset" as const,
      title: a.contentTitle,
      subtitle: `${a.channelName} · ${a.channelType}`,
      body: null as string | null,
      status: a.status,
      href: `/soportes/${a.id}`,
      externalHref: null,
      publishedAt: null,
      reach: null,
      sourceType: a.channelType,
    };
  }, [hovered, findings, ideas, flatAssets]);

  const hoveredPos = useMemo(() => {
    if (!hovered) return null;
    const p = posOf(hovered.kind, hovered.id);
    let x = p.x;
    let y = p.y;
    if (hovered.kind === "idea") {
      x += coreShift.x;
      y += coreShift.y;
    }
    // Aplica el transform de zoom/pan para que el popover siga al nodo.
    return { x: x * view.scale + view.tx, y: y * view.scale + view.ty };
  }, [hovered, posOf, coreShift, view]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div
        ref={hostRef}
        className="spider-host relative min-h-0 w-full flex-1 overflow-visible bg-gradient-to-br from-background/40 via-background/20 to-background/60 backdrop-blur"
      >
        {/* Toolbar interna, anclada abajo a la derecha */}
        <div className="pointer-events-none absolute bottom-3 right-3 z-20 flex flex-wrap items-center justify-end gap-2">
          <span className="pointer-events-auto hidden items-center gap-1 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[10px] uppercase tracking-widest text-muted-foreground backdrop-blur md:inline-flex">
            <GripHorizontal className="h-3 w-3" /> arrastra · rueda para zoom
          </span>
          <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-full border border-border/60 bg-background/80 backdrop-blur">
            <button
              type="button"
              onClick={() => zoomAt(W / 2, H / 2, 0.9)}
              aria-label="Zoom out"
              title="Zoom out"
              className="px-2 py-1 text-muted-foreground transition hover:text-foreground"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[3ch] border-x border-border/50 px-2 py-1 text-center text-[10px] font-semibold tabular-nums text-foreground">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => zoomAt(W / 2, H / 2, 1.1)}
              aria-label="Zoom in"
              title="Zoom in"
              className="px-2 py-1 text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={resetLayout}
            className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur transition hover:border-primary/40 hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Reordenar
          </button>
        </div>
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 50% 50%, hsl(var(--primary) / 0.16), transparent 70%)",
          }}
          aria-hidden
        />

        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full touch-none select-none"
          role="img"
          aria-label="Diagrama tipo araña del pipeline editorial SpAIder"
          onPointerDown={onBgPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ cursor: panRef.current?.moved ? "grabbing" : "grab" }}
        >
          {/* Rect de fondo para captar el click en espacio vacío y permitir pan */}
          <rect
            x={-W * 4}
            y={-H * 4}
            width={W * 9}
            height={H * 9}
            fill="transparent"
            pointerEvents="all"
          />
          <defs>
            <radialGradient id="core-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.18)" />
              <stop offset="55%" stopColor="hsl(var(--primary) / 0.08)" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0)" />
            </radialGradient>
            <radialGradient id="idea-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.95)" />
              <stop offset="70%" stopColor="hsl(var(--primary) / 0.35)" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0)" />
            </radialGradient>
            <radialGradient id="node-outer" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="hsl(var(--card))" stopOpacity="0.9" />
              <stop offset="80%" stopColor="hsl(var(--card))" stopOpacity="0.4" />
              <stop offset="100%" stopColor="hsl(var(--card))" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="strand-left" x1="0%" y1="50%" x2="100%" y2="50%">
              {/* Lima profundo: destaca la trazabilidad finding → idea en claro y oscuro */}
              <stop offset="0%" stopColor="hsl(var(--accent-deep) / 0.55)" />
              <stop offset="100%" stopColor="hsl(var(--accent-deep) / 0.95)" />
            </linearGradient>
            <linearGradient id="strand-right" x1="0%" y1="50%" x2="100%" y2="50%">
              <stop offset="0%" stopColor="hsl(var(--primary) / 0.95)" />
              <stop offset="100%" stopColor="hsl(var(--primary) / 0.45)" />
            </linearGradient>
            <filter id="soft-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="deep-glow" x="-80%" y="-80%" width="260%" height="260%">
              <feGaussianBlur stdDeviation="16" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <clipPath id="body-clip">
              <circle
                cx={CORE.x + coreShift.x}
                cy={CORE.y + coreShift.y}
                r={BODY_R - 4}
              />
            </clipPath>
          </defs>

          {/* Envolvente de zoom/pan: escala todo el contenido del diagrama. */}
          <g transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}>

          {/* Telaraña de fondo */}
          <g opacity="0.28" stroke="hsl(var(--accent-deep))" strokeWidth="1" fill="none">
            {Array.from({ length: 4 }).map((_, ring) => (
              <ellipse
                key={ring}
                cx={CORE.x + coreShift.x}
                cy={CORE.y + coreShift.y}
                rx={200 + ring * 110}
                ry={150 + ring * 80}
                strokeDasharray="1 6"
              />
            ))}
          </g>

          {/* Hilos finding → idea. Un hilo POR CADA finding que contribuyó a
              una idea aprobada (many-to-one). El finding "resaltado" cuando
              está hovereado es más fuerte para dejar clara su trazabilidad. */}
          <g fill="none" strokeLinecap="round">
            {findings.map((f) => {
              if (!f.ideaId) return null;
              const idea = ideas.find((i) => i.id === f.ideaId);
              if (!idea) return null;
              const fp = posOf("finding", f.id);
              const ip = ideaAnchorFor(idea.id);
              const { a, b } = trimSegment(fp, ip, NODE_R, NODE_R);
              const op = strandOp(a, b);
              const isActive =
                (hovered?.kind === "finding" && hovered.id === f.id) ||
                (hovered?.kind === "idea" && hovered.id === idea.id);
              return (
                <path
                  key={`strand-f-${f.id}`}
                  d={curveTo(a, b, "left")}
                  stroke={
                    isActive
                      ? "hsl(var(--primary))"
                      : "url(#strand-left)"
                  }
                  strokeWidth={isActive ? 2 : 1.3}
                  opacity={isActive ? 1 : op}
                />
              );
            })}
          </g>

          {/* Hilos idea → asset */}
          <g fill="none" strokeLinecap="round">
            {flatAssets.map((asset) => {
              const ap = posOf("asset", asset.id);
              const ip = ideaAnchorFor(asset.ideaId);
              const { a, b } = trimSegment(ip, ap, NODE_R, NODE_R);
              const op = strandOp(a, b);
              return (
                <g key={`strand-a-${asset.id}`} opacity={op}>
                  <path
                    d={curveTo(a, b, "right")}
                    stroke="url(#strand-right)"
                    strokeWidth="1.8"
                  />
                  <path
                    d={curveTo(a, b, "right")}
                    stroke="url(#strand-right)"
                    strokeWidth="0.9"
                    strokeDasharray="2 5"
                    className={reducedMotion ? undefined : "spider-strand-dash"}
                  />
                </g>
              );
            })}
          </g>

          {/* Núcleo */}
          <g transform={`translate(${coreShift.x} ${coreShift.y})`}>
            <circle
              cx={CORE.x}
              cy={CORE.y}
              r={BODY_R + 40}
              fill="url(#core-grad)"
              className={reducedMotion ? undefined : "spider-core-pulse"}
              filter="url(#deep-glow)"
              opacity="0.12"
            />
            <circle
              cx={CORE.x}
              cy={CORE.y}
              r={BODY_R}
              fill="hsl(var(--card) / 0.06)"
              stroke="hsl(var(--primary) / 0.35)"
              strokeWidth="1"
            />

            <g clipPath="url(#body-clip)">
              {ideas.map((idea) => {
                const p = posOf("idea", idea.id);
                const isActive =
                  hovered?.kind === "idea" && hovered.id === idea.id;
                return (
                  <Link
                    key={idea.id}
                    href={`/ideas/${idea.id}`}
                    className="spider-node-link"
                    onClickCapture={maybeBlockClick}
                  >
                    <g
                      className="spider-node spider-idea"
                      onPointerDown={(ev) =>
                        onPointerDown("idea", idea.id, ev)
                      }
                      onMouseEnter={() => {
                        if (dragRef.current || panRef.current) return;
                        setHovered({ kind: "idea", id: idea.id });
                      }}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={NODE_R + 4}
                        fill="url(#idea-grad)"
                        opacity={isActive ? 0.75 : 0.5}
                      />
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={NODE_R}
                        fill={isActive ? "hsl(var(--accent-deep))" : "hsl(var(--primary))"}
                        stroke="hsl(var(--accent-deep))"
                        strokeWidth={isActive ? 2 : 1}
                      />
                      <foreignObject
                        x={p.x - NODE_R + 2}
                        y={p.y - NODE_R + 2}
                        width={(NODE_R - 2) * 2}
                        height={(NODE_R - 2) * 2}
                      >
                        <div className="flex h-full w-full items-center justify-center text-primary-foreground">
                          <Lightbulb className="h-6 w-6" />
                        </div>
                      </foreignObject>
                    </g>
                  </Link>
                );
              })}
            </g>
          </g>

          {/* FINDINGS */}
          {findings.map((f) => {
            const p = posOf("finding", f.id);
            const isNew = f.status === "NEW";
            const SourceIcon = iconForSourceType(f.sourceType);
            const isActive =
              hovered?.kind === "finding" && hovered.id === f.id;
            return (
              <Link
                key={f.id}
                href={`/investigacion/hallazgos/${f.id}`}
                className="spider-node-link"
                onClickCapture={maybeBlockClick}
              >
                <g
                  className="spider-node"
                  onPointerDown={(ev) => onPointerDown("finding", f.id, ev)}
                  onMouseEnter={() => {
                    if (dragRef.current || panRef.current) return;
                    setHovered({ kind: "finding", id: f.id });
                  }}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={NODE_R + 6}
                    fill="url(#node-outer)"
                    filter="url(#soft-glow)"
                    opacity={isActive ? 1 : 0.6}
                  />
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={NODE_R}
                    fill={
                      isActive
                        ? "hsl(var(--accent-deep))"
                        : isNew
                          ? "hsl(var(--primary))"
                          : "hsl(var(--accent-soft))"
                    }
                    stroke="hsl(var(--accent-deep))"
                    strokeWidth={isActive ? 2 : 1}
                  />
                  <foreignObject
                    x={p.x - NODE_R + 2}
                    y={p.y - NODE_R + 2}
                    width={(NODE_R - 2) * 2}
                    height={(NODE_R - 2) * 2}
                  >
                    <div className="flex h-full w-full items-center justify-center text-primary-foreground">
                      <SourceIcon className="h-6 w-6" />
                    </div>
                  </foreignObject>
                </g>
              </Link>
            );
          })}

          {/* ASSETS */}
          {flatAssets.map((a) => {
            const ap = posOf("asset", a.id);
            const ChannelIcon = iconForChannelType(a.channelType);
            const isLive =
              a.status === "PUBLISHED" || a.status === "SCHEDULED";
            const isActive =
              hovered?.kind === "asset" && hovered.id === a.id;
            return (
              <Link
                key={a.id}
                href={`/soportes/${a.id}`}
                className="spider-node-link"
                onClickCapture={maybeBlockClick}
              >
                <g
                  className="spider-node"
                  onPointerDown={(ev) => onPointerDown("asset", a.id, ev)}
                  onMouseEnter={() => {
                    if (dragRef.current || panRef.current) return;
                    setHovered({ kind: "asset", id: a.id });
                  }}
                  onMouseLeave={() => setHovered(null)}
                >
                  <circle
                    cx={ap.x}
                    cy={ap.y}
                    r={NODE_R + 6}
                    fill="url(#node-outer)"
                    filter="url(#soft-glow)"
                    opacity={isActive ? 1 : 0.6}
                  />
                  <circle
                    cx={ap.x}
                    cy={ap.y}
                    r={NODE_R}
                    fill={
                      isActive
                        ? "hsl(var(--accent-deep))"
                        : isLive
                          ? "hsl(var(--primary))"
                          : "hsl(var(--accent-soft))"
                    }
                    stroke="hsl(var(--accent-deep))"
                    strokeWidth={isActive ? 2 : 1}
                  />
                  <foreignObject
                    x={ap.x - NODE_R + 2}
                    y={ap.y - NODE_R + 2}
                    width={(NODE_R - 2) * 2}
                    height={(NODE_R - 2) * 2}
                  >
                    <div className="flex h-full w-full items-center justify-center text-primary-foreground">
                      <ChannelIcon className="h-6 w-6" />
                    </div>
                  </foreignObject>
                </g>
              </Link>
            );
          })}

          </g>
        </svg>

        {/* Hover card — popover HTML flotante sobre el SVG */}
        {hovered && hoveredData && hoveredPos && (
          <HoverCard data={hoveredData} x={hoveredPos.x} y={hoveredPos.y} />
        )}

        <style jsx>{`
          .spider-host :global(.spider-core-pulse) {
            transform-origin: center;
            transform-box: fill-box;
            animation: core-pulse 7s ease-in-out infinite;
          }
          @keyframes core-pulse {
            0%, 100% { transform: scale(1); opacity: 0.9; }
            50% { transform: scale(1.05); opacity: 1; }
          }
          .spider-host :global(.spider-strand-dash) {
            animation: strand-flow 5s linear infinite;
          }
          @keyframes strand-flow {
            0% { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: -24; }
          }
          .spider-host :global(.spider-node) {
            transition: transform 180ms ease-out, filter 180ms ease-out;
            transform-box: fill-box;
            transform-origin: center;
            cursor: grab;
            touch-action: none;
          }
          .spider-host :global(.spider-node:active) { cursor: grabbing; }
          .spider-host :global(.spider-idea) { cursor: pointer; }
          .spider-host :global(.spider-node-link:focus-visible .spider-node),
          .spider-host :global(.spider-node-link:hover .spider-node) {
            filter: drop-shadow(0 0 10px hsl(var(--primary) / 0.55));
          }
          @media (prefers-reduced-motion: reduce) {
            .spider-host :global(.spider-core-pulse),
            .spider-host :global(.spider-strand-dash) {
              animation: none !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

// ── HoverCard ───────────────────────────────────────────────────────────
type HoverData = {
  kind: NodeKind;
  title: string;
  subtitle: string;
  body: string | null;
  status: string;
  href: string;
  externalHref: string | null;
  publishedAt: string | null;
  reach: number | null;
  sourceType: string;
};

function HoverCard({
  data,
  x,
  y,
}: {
  data: HoverData;
  x: number;
  y: number;
}) {
  const kindLabel =
    data.kind === "finding"
      ? "Hallazgo"
      : data.kind === "idea"
        ? "Idea aprobada"
        : "Pieza";
  const KindIcon =
    data.kind === "finding"
      ? iconForSourceType(data.sourceType)
      : data.kind === "idea"
        ? Lightbulb
        : iconForChannelType(data.sourceType);

  // Decide si colocar arriba o abajo del nodo según su posición vertical en el
  // lienzo 1400×820. Si está en la mitad superior, el popover va por debajo
  // (para no salirse del contenedor). Si está abajo, va por encima.
  const above = y > H / 2;
  // Lado horizontal: nodos muy a la izquierda abren a la derecha y viceversa,
  // para que el popover no desborde.
  const alignStart = x < W * 0.22;
  const alignEnd = x > W * 0.78;

  // Transform base: centrado horizontalmente sobre el nodo.
  let transform = "translate(-50%, 0)";
  if (alignStart) transform = "translate(0, 0)";
  else if (alignEnd) transform = "translate(-100%, 0)";

  // Vertical: offset respecto al nodo + sentido.
  const topStyle = above
    ? { top: `${(y / H) * 100}%`, transform: `${transform} translate(0, calc(-100% - 22px))` }
    : { top: `${(y / H) * 100}%`, transform: `${transform} translate(0, 22px)` };

  return (
    <div
      className="pointer-events-none absolute z-30"
      style={{
        left: `${(x / W) * 100}%`,
        ...topStyle,
      }}
    >
      <div
        className="w-72 rounded-xl border border-primary/40 p-4 shadow-2xl shadow-primary/30"
        style={{
          // Fondo 100% opaco para que el popover no se mezcle con lo que hay
          // detrás (burbujas, hilos, telaraña). Sin backdrop-blur.
          backgroundColor: "hsl(var(--card))",
        }}
      >
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-foreground/90">
          <KindIcon className="h-3 w-3" />
          {kindLabel}
          <span className="ml-auto rounded-full border border-border/60 bg-background/60 px-2 py-0.5 text-[9px] tracking-wider text-muted-foreground">
            {data.status}
          </span>
        </div>
        <p className="mt-2 text-sm font-semibold leading-snug text-foreground line-clamp-2">
          {data.title}
        </p>
        {data.subtitle && (
          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">
            {data.subtitle}
          </p>
        )}
        {data.body && (
          <p className="mt-2 text-[11px] text-muted-foreground/90 line-clamp-4">
            {data.body}
          </p>
        )}
        {(data.publishedAt || data.reach) && (
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
            {data.publishedAt && (
              <span>
                {new Date(data.publishedAt).toLocaleDateString("es-ES")}
              </span>
            )}
            {data.reach && (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" />
                {compactNum(data.reach)}
              </span>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-2 text-[11px] text-foreground">
          <span className="inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" />
            Abrir
          </span>
        </div>
      </div>
    </div>
  );
}

function compactNum(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1_000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

function nodeKey(kind: NodeKind, id: string) {
  return `${kind}:${id}`;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
