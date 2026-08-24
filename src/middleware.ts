import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

/**
 * Matcher: cubre todas las rutas de la app excepto assets estáticos.
 * Las APIs NO se excluyen: queremos que `authorized` en auth.config.ts
 * decida su política (incluidas `/api/auth/*` que devuelve true).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
