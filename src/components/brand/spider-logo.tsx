import { SVGProps } from "react";

/**
 * SpAIder brand mark — araña estilizada en trazo, colgando de un hilo de telaraña.
 * Usa `currentColor` para que herede el color del texto y pueda pintarse
 * con `text-salmon-500`, `text-foreground`, `text-white`, etc.
 */
export function SpiderLogo({
  className,
  strokeWidth = 2.2,
  ...props
}: SVGProps<SVGSVGElement> & { strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
      {...props}
    >
      {/* hilo de telaraña */}
      <path
        d="M24 3 L24 17"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeDasharray="2 2.5"
      />

      {/* cuerpo */}
      <circle
        cx="24"
        cy="24"
        r="6.2"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* ojos */}
      <circle cx="21.6" cy="22.3" r="0.95" fill="currentColor" />
      <circle cx="26.4" cy="22.3" r="0.95" fill="currentColor" />

      {/* patas izquierda (de arriba a abajo) */}
      <path
        d="M18.5 20 L11 14 L7 16.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 23 L8.5 22 L4.5 25"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 26.5 L8.5 29.5 L5 33.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 29 L15 36.5 L11.5 42"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* patas derecha */}
      <path
        d="M29.5 20 L37 14 L41 16.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 23 L39.5 22 L43.5 25"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 26.5 L39.5 29.5 L43 33.5"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28 29 L33 36.5 L36.5 42"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
