"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Botón "Volver" genérico para el layout de dashboard.
 *
 * - En `/dashboard` no se muestra (es el anclaje).
 * - Calcula el padre quitando el último segmento del pathname:
 *     /investigacion/fuentes    → /investigacion
 *     /investigacion            → /dashboard
 *     /produccion/[id]          → /produccion
 *     /admin/usuarios           → /admin
 * - El label describe el destino: "Volver a Investigación", "Volver al dashboard", etc.
 */

// Override manual solo si el auto-derive no es lo que queremos.
const PARENT_OVERRIDES: Record<string, string> = {};

// Mapa de etiquetas por segmento raíz.
const SECTION_LABEL: Record<string, string> = {
  dashboard: "Panel",
  investigacion: "Investigación",
  analisis: "Análisis",
  ideas: "Ideas",
  produccion: "Producción",
  soportes: "Creaciones",
  marca: "Marca",
  chat: "Chat",
  agentes: "Agentes",
  automatizaciones: "Automatizaciones",
  admin: "Administración",
};

export function BackLink() {
  const pathname = usePathname() ?? "";
  if (!pathname || pathname === "/dashboard" || pathname === "/") return null;

  const segments = pathname.split("/").filter(Boolean);
  let parent: string;
  if (segments.length <= 1) {
    parent = "/dashboard";
  } else {
    parent = "/" + segments.slice(0, -1).join("/");
  }
  if (PARENT_OVERRIDES[pathname]) parent = PARENT_OVERRIDES[pathname];

  // Calcula etiqueta amigable del destino
  const parentSegs = parent.split("/").filter(Boolean);
  let label = "Volver";
  if (parent === "/dashboard") {
    label = "Volver al resumen";
  } else {
    const first = parentSegs[0];
    const section = SECTION_LABEL[first];
    if (section) {
      label = parentSegs.length === 1 ? `Volver a ${section}` : `Volver`;
    }
  }

  return (
    <Link
      href={parent}
      aria-label={label}
      className="group inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-background/40 transition-colors group-hover:border-primary/50 group-hover:text-foreground">
        <ArrowLeft className="h-3 w-3" />
      </span>
      {label}
    </Link>
  );
}
