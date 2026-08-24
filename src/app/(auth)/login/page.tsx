import { Suspense } from "react";
import { getGoogleAuth } from "@/lib/auth/google-auth";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Solo el flag: las credenciales nunca llegan al cliente.
  const googleEnabled = await getGoogleAuth()
    .then((g) => g.enabled && !!g.clientId && !!g.clientSecret)
    .catch(() => false);
  return (
    <div className="grid w-full max-w-[1080px] items-center gap-10 p-2 lg:grid-cols-2 lg:gap-20 lg:p-6">
      {/* Lado editorial — solo en pantallas grandes */}
      <div className="hidden flex-col gap-6 lg:flex">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground before:mr-2 before:inline-block before:h-px before:w-6 before:bg-muted-foreground before:align-middle before:content-['']">
          SpAIder · Pipeline editorial
        </p>
        <h1 className="font-serif text-[clamp(40px,4.5vw,56px)] font-normal leading-[1.05] tracking-[-0.02em] text-foreground">
          Convierte <span className="wavy">señales sueltas</span> en publicaciones con criterio.
        </h1>
        <p className="max-w-[38ch] text-[15px] leading-relaxed text-muted-foreground">
          La IA investiga tus fuentes, tú apruebas las ideas que valen y SpAIder
          produce las piezas adaptadas a cada canal.
        </p>
        <div className="mt-2 flex items-center gap-6 border-t border-border/50 pt-5">
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Flujo
            </span>
            <span className="font-num text-sm text-foreground">
              Investigar → Aprobar → Publicar
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
              Estado
            </span>
            <span className="flex items-center gap-1.5 font-num text-sm text-foreground">
              <span className="inline-block h-[7px] w-[7px] rounded-full bg-ok" aria-hidden />
              Operativo
            </span>
          </div>
        </div>
      </div>

      {/* Tarjeta de acceso */}
      <div className="flex justify-center lg:justify-end">
        <Suspense
          fallback={
            <div className="glass-card w-full max-w-sm p-8 text-center text-sm text-muted-foreground">
              Cargando…
            </div>
          }
        >
          <LoginForm googleEnabled={googleEnabled} />
        </Suspense>
      </div>
    </div>
  );
}
