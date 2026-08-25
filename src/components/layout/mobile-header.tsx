"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { NavLinks } from "./nav-links";
import { UserMenu } from "./user-menu";
import { ThemeToggle } from "./theme-toggle";
import { MarketeriaWordmark } from "@/components/brand/marketeria-logo";

export function MobileHeader({
  user,
}: {
  user: { name: string; email: string; role: string };
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center gap-2">
          <MarketeriaWordmark className="h-[22px]" priority />
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            type="button"
            aria-label="Abrir menú"
            onClick={() => setOpen(true)}
            className="rounded-md p-2 hover:bg-accent"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="relative ml-auto flex h-full w-72 flex-col border-l border-border bg-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <MarketeriaWordmark className="h-[22px]" />
              <button
                type="button"
                aria-label="Cerrar menú"
                onClick={() => setOpen(false)}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto" onClick={() => setOpen(false)}>
              <NavLinks role={user.role} />
            </div>
            <div className="border-t border-border/40 pt-3">
              <UserMenu name={user.name} email={user.email} role={user.role} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
