"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  Lightbulb,
  Share2,
  MessageSquare,
  Bot,
  Zap,
  BarChart3,
  Shield,
  Palette,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean };

const pipeline: Item[] = [
  { href: "/dashboard", label: "Panel", icon: BarChart3 },
  { href: "/investigacion", label: "Investigación", icon: Search },
  { href: "/ideas", label: "Ideas", icon: Lightbulb },
  // El paso final del pipeline editorial se llama "Creaciones" en UI
  // (la ruta es /soportes).
  // En "Módulos → Canales" vive la configuración de canales — son cosas
  // distintas y queremos evitar que el usuario las confunda.
  { href: "/soportes", label: "Creaciones", icon: Share2 },
];

const modules: Item[] = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/agentes", label: "Agentes", icon: Bot },
  // Solo ADMIN: sus APIs (crear/ejecutar) exigen admin; mostrarla a EDITOR
  // producía un flujo roto (creaba la Source y el POST de la automatización daba 403).
  { href: "/automatizaciones", label: "Automatizaciones", icon: Zap, adminOnly: true },
  { href: "/modulos/canales", label: "Canales", icon: LayoutGrid },
  { href: "/marca", label: "Marca", icon: Palette },
  { href: "/admin", label: "Admin", icon: Shield, adminOnly: true },
];

export function NavLinks({ role, collapsed = false }: { role: string; collapsed?: boolean }) {
  const pathname = usePathname();

  const renderItem = (item: Item) => {
    const active =
      pathname === item.href ||
      (item.href !== "/dashboard" && pathname.startsWith(item.href));
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          "group relative flex items-center rounded-lg py-2 text-sm font-medium transition-colors",
          collapsed ? "justify-center px-0" : "gap-3 px-3",
          active
            ? "bg-card text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]"
            : "text-foreground/75 hover:bg-foreground/[0.04] hover:text-foreground",
        )}
      >
        {active && !collapsed && (
          <span
            aria-hidden
            className="absolute -left-1.5 bottom-2 top-2 w-[3px] rounded-full bg-accent-soft"
          />
        )}
        <Icon
          className={cn(
            "h-[17px] w-[17px] shrink-0 transition-opacity",
            active ? "opacity-100" : "opacity-70",
          )}
        />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  };

  return (
    <nav className={cn("flex flex-col gap-5", collapsed ? "px-2" : "px-3")}>
      <div>
        {!collapsed && (
          <p className="eyebrow mb-2 px-2.5 text-[10px] tracking-[0.16em]">
            Pipeline editorial
          </p>
        )}
        <div className="flex flex-col gap-0.5">{pipeline.map(renderItem)}</div>
      </div>
      <div>
        {!collapsed && (
          <p className="eyebrow mb-2 px-2.5 text-[10px] tracking-[0.16em]">
            Módulos
          </p>
        )}
        <div className="flex flex-col gap-0.5">
          {modules.filter((m) => !m.adminOnly || role === "ADMIN").map(renderItem)}
        </div>
      </div>
    </nav>
  );
}
