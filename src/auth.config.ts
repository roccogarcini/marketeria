import type { NextAuthConfig } from "next-auth";
import type { UserRole } from "@/types/next-auth";

/**
 * Configuración NextAuth edge-safe (sin Prisma ni bcrypt).
 * Se consume desde `middleware.ts` y desde `auth.ts`.
 *
 * Nota: los callbacks `jwt` y `session` viven aquí (no en auth.ts) para que
 * el middleware edge pueda leer `role` al autorizar.
 *
 * Política de acceso:
 *  - Rutas protegidas: `/dashboard/*`, `/admin/*`, y TODAS las rutas de API
 *    excepto `/api/auth/*` (flujo NextAuth público).
 *  - `/admin/*` (y `/api/admin/*`) exigen rol ADMIN.
 *  - `/login` redirige a `/dashboard` si el usuario ya está autenticado.
 *  - Resto de páginas (home `/`) → públicas.
 */
export const authConfig = {
  // Self-hosted detras de reverse proxy (EasyPanel): el host valido es el
  // que fija NEXTAUTH_URL; sin esto Auth.js v5 rechaza con UntrustedHost.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = user.role as UserRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
      }
      return session;
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const role = auth?.user?.role;
      const { pathname } = nextUrl;

      // Rutas públicas explícitas: NextAuth flow + health check
      const isAuthApi = pathname.startsWith("/api/auth");
      const isHealth = pathname === "/api/health";
      if (isAuthApi || isHealth) return true;

      // Webhooks de entrada (WhatsApp): los llama el proveedor, sin sesión.
      // No van sin protección: cada uno verifica su propio secreto (verify
      // token en el alta, firma HMAC del cuerpo en cada evento) y falla
      // cerrado si no está configurado.
      if (pathname.startsWith("/api/webhooks/")) return true;

      // API externa (/api/v1/**) y servidor MCP (/api/mcp, /api/sse,
      // /api/message): autentican por API key en el propio handler
      // (requireApiKey/verifyApiKey), no por sesión.
      const isExternalApi =
        pathname.startsWith("/api/v1/") ||
        pathname === "/api/mcp" ||
        pathname === "/api/sse" ||
        pathname === "/api/message";
      if (isExternalApi) return true;

      const isApi = pathname.startsWith("/api/");
      const isAdminArea =
        pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
      const isDashboard = pathname.startsWith("/dashboard");
      const isLogin = pathname.startsWith("/login");
      const isLogout = pathname.startsWith("/logout");

      if (isLogin) {
        if (isLoggedIn) {
          return Response.redirect(new URL("/dashboard", nextUrl));
        }
        return true;
      }

      if (isLogout) {
        return true;
      }

      if (isAdminArea) {
        if (!isLoggedIn) return false;
        return role === "ADMIN";
      }

      if (isDashboard) {
        return isLoggedIn;
      }

      if (isApi) {
        return isLoggedIn;
      }

      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
