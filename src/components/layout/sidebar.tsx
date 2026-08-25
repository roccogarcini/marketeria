"use client";

import { useEffect, useState } from "react";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { signOut } from "next-auth/react";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { MarketeriaMark, MarketeriaWordmark } from "@/components/brand/marketeria-logo";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "spaider:sidebar-collapsed";

function BotonColapsar({
  collapsed,
  onClick,
}: {
  collapsed: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? "Expandir menú" : "Colapsar menú"}
      title={collapsed ? "Expandir" : "Colapsar"}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
    >
      {collapsed ? (
        <PanelLeftOpen className="h-[18px] w-[18px]" />
      ) : (
        <PanelLeftClose className="h-[18px] w-[18px]" />
      )}
    </button>
  );
}

export function Sidebar({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    } catch {
      /* localStorage no disponible */
    }
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen flex-col border-r border-border bg-card transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Cabecera: logotipo arriba, a todo el ancho, y el botón de colapsar en
          la línea del subtítulo. Compartiendo fila con el botón, al logo solo
          le quedaban 122px de los 200 útiles; así se lleva los 200 enteros. */}
      <div className={cn("pb-4 pt-[18px]", collapsed ? "px-0" : "px-5")}>
        {collapsed ? (
          <div className="flex flex-col items-center gap-3">
            <MarketeriaMark className="h-10" />
            <BotonColapsar collapsed={collapsed} onClick={toggle} />
          </div>
        ) : (
          <>
            <MarketeriaWordmark className="h-[62px]" priority />
            <div className="mt-1 flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground">Pipeline editorial</p>
              <BotonColapsar collapsed={collapsed} onClick={toggle} />
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <NavLinks role={user.role} collapsed={collapsed} />
      </div>

      <div
        className={cn(
          "flex border-t border-border p-3",
          collapsed ? "flex-col items-center gap-2" : "items-center gap-2",
        )}
      >
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <UserMenu name={user.name} email={user.email} role={user.role} />
          </div>
        )}
        <ThemeToggle />
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-card text-foreground/70 transition-colors hover:border-foreground hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
