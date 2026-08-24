"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Search, ChevronDown, Telescope, Share2, Youtube, Settings2 } from "lucide-react";
import { AIResearchLauncher } from "./ai-research-launcher";
import { ApifyLauncher } from "./apify-launcher";
import { YoutubeLauncher } from "./youtube-launcher";

type Source = {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  platform?: string | null;
  configJson?: string | null;
};

/**
 * Acciones de la cabecera de Investigación, separando dos conceptos:
 *   - "Buscar ahora" → búsqueda puntual (IA, redes/Apify, YouTube). Abre el
 *     lanzador correspondiente; cada uno guarda la búsqueda como fuente.
 *   - "Fuentes" → gestión de fuentes recurrentes (/investigacion/fuentes).
 */
export function ResearchActions({ sources }: { sources: Source[] }) {
  const [which, setWhich] = useState<null | "ia" | "apify" | "youtube">(null);
  const closeAll = (v: boolean) => {
    if (!v) setWhich(null);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="gap-1.5">
            <Search className="h-4 w-4" /> Buscar ahora
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>Búsqueda puntual</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setWhich("ia")} className="gap-2">
            <Telescope className="h-4 w-4" />
            <div className="flex flex-col">
              <span>Investigar con IA</span>
              <span className="text-[11px] text-muted-foreground">
                Brief → la IA busca en la web
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setWhich("apify")} className="gap-2">
            <Share2 className="h-4 w-4" />
            <div className="flex flex-col">
              <span>Buscar en redes (Apify)</span>
              <span className="text-[11px] text-muted-foreground">
                Instagram, TikTok, LinkedIn, X…
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setWhich("youtube")} className="gap-2">
            <Youtube className="h-4 w-4" />
            <div className="flex flex-col">
              <span>Buscar en YouTube</span>
              <span className="text-[11px] text-muted-foreground">
                API oficial (gratis)
              </span>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/investigacion/fuentes" className="gap-2">
              <Settings2 className="h-4 w-4" /> Gestionar fuentes recurrentes
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button asChild variant="outline" size="sm">
        <Link href="/investigacion/fuentes">
          <Settings2 className="h-4 w-4" /> Fuentes
        </Link>
      </Button>

      {/* Lanzadores controlados (sin su propio botón) */}
      <AIResearchLauncher
        open={which === "ia"}
        onOpenChange={closeAll}
        showTrigger={false}
      />
      <ApifyLauncher
        sources={sources}
        open={which === "apify"}
        onOpenChange={closeAll}
        showTrigger={false}
      />
      <YoutubeLauncher
        sources={sources}
        open={which === "youtube"}
        onOpenChange={closeAll}
        showTrigger={false}
      />
    </div>
  );
}
