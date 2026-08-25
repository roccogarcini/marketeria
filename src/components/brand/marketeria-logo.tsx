import Image from "next/image";
import { cn } from "@/lib/utils";

/*
 * Logotipo de Marketería.
 *
 * Dos ficheros, no uno recoloreado: el manual fija una versión marino para
 * fondos claros y una blanca para fondos oscuros, y en ambas el triángulo se
 * queda lima. El cambio va por CSS (`dark:`) y no por JS, para que no haya
 * parpadeo mientras el tema hidrata.
 *
 * La altura la pone quien lo usa (`className="h-8"`); el ancho se deduce.
 * Nunca estirar, rotar ni añadir sombras: regla de marca.
 */

function Par({
  claro,
  oscuro,
  ancho,
  alto,
  className,
  priority,
}: {
  claro: string;
  oscuro: string;
  ancho: number;
  alto: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span className={cn("inline-block shrink-0", className)}>
      <Image
        src={claro}
        alt="Marketería"
        width={ancho}
        height={alto}
        priority={priority}
        className="h-full w-auto dark:hidden"
      />
      <Image
        src={oscuro}
        alt=""
        aria-hidden
        width={ancho}
        height={alto}
        priority={priority}
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
}

/** Logotipo completo (M + "Marketería"). Ancho mínimo recomendado: 90px. */
export function MarketeriaWordmark(props: { className?: string; priority?: boolean }) {
  return (
    <Par
      claro="/brand/marketeria-navy.png"
      oscuro="/brand/marketeria-white.png"
      ancho={1037}
      alto={341}
      {...props}
    />
  );
}

/** Solo la marca cuadrada (M + triángulo). Para menú colapsado e iconos. */
export function MarketeriaMark(props: { className?: string; priority?: boolean }) {
  return (
    <Par
      claro="/brand/marketeria-mark-navy.png"
      oscuro="/brand/marketeria-mark-white.png"
      ancho={512}
      alto={512}
      {...props}
    />
  );
}
