import type { ReactNode } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";

// Bocadillos flotantes del login: SUBEN de abajo arriba. Delays negativos para
// que arranquen ya a media subida (sin parón). Solo en escritorio.
const PILLS: { text: string; x: string; duration: string; delay: string; hot?: boolean }[] = [
  { text: "Hallazgo capturado", x: "9%", duration: "22s", delay: "-2s", hot: true },
  { text: "Idea aprobada · Newsletter", x: "80%", duration: "26s", delay: "-13s" },
  { text: "3 fuentes nuevas", x: "16%", duration: "24s", delay: "-18s" },
  { text: "Carrusel listo para revisar", x: "84%", duration: "28s", delay: "-8s", hot: true },
  { text: "Investigación · lunes 08:00", x: "12%", duration: "30s", delay: "-24s", hot: true },
  { text: "Publicado en LinkedIn", x: "74%", duration: "25s", delay: "-15s" },
];

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* Escenario animado: blobs lima a la deriva + grano de papel + pauta */}
      <div className="auth-stage" aria-hidden>
        <div className="auth-lines" />
        <div className="auth-blob auth-blob-1" />
        <div className="auth-blob auth-blob-2" />
        <div className="auth-blob auth-blob-3" />
      </div>
      <div className="auth-grain" aria-hidden />

      {/* Toggle claro/oscuro — arriba derecha, solo icono */}
      <ThemeToggle className="absolute right-4 top-4 z-20 rounded-xl" />

      {/* Bocadillos flotantes (efecto "wow") — detrás de la tarjeta */}
      <div className="auth-pills hidden lg:block" aria-hidden>
        {PILLS.map((p) => (
          <span
            key={p.text}
            className={`auth-pill${p.hot ? " hot" : ""}`}
            style={{ left: p.x, animationDuration: p.duration, animationDelay: p.delay }}
          >
            <span className="dot" />
            {p.text}
          </span>
        ))}
      </div>

      <div className="relative z-10 flex w-full justify-center">{children}</div>
    </main>
  );
}
