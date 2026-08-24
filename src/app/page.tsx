import { redirect } from "next/navigation";

/**
 * La ruta raíz redirige directamente al dashboard. El middleware gestiona la
 * redirección a /login si no hay sesión activa.
 */
export default function RootPage() {
  redirect("/dashboard");
}
