import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/hash";
import { getGoogleAuth } from "@/lib/auth/google-auth";
import {
  clearLoginFailures,
  clientIpFrom,
  isLoginBlocked,
  registerLoginFailure,
} from "@/lib/auth/rate-limit";
import { authConfig } from "./auth.config";
import type { UserRole } from "@/types/next-auth";

/**
 * Configuración NextAuth completa (Node runtime), en modo LAZY: se evalúa por
 * petición para poder añadir el proveedor Google según lo configurado en el
 * panel admin (AppSetting cifrado), sin redeploy.
 *
 * Los callbacks `jwt`/`session`/`authorized` base viven en `auth.config.ts`
 * (edge-safe, para el middleware); aquí se extiende `jwt` y se añade `signIn`
 * para la política de Google: SOLO usuarios ya dados de alta y activos.
 */
const credentialsProvider = Credentials({
  credentials: {
    email: { label: "Email", type: "email" },
    password: { label: "Contraseña", type: "password" },
  },
  async authorize(credentials, request) {
    if (!credentials?.email || !credentials?.password) {
      return null;
    }

    const email = String(credentials.email).trim().toLowerCase();
    const password = String(credentials.password);
    const ip = clientIpFrom(request);

    // Rate-limit: 5 fallos por IP+email en 15 min. Mismo `null` genérico
    // que un fallo de credenciales para no filtrar el estado del bloqueo.
    if (isLoginBlocked(ip, email)) {
      return null;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      registerLoginFailure(ip, email);
      return null;
    }

    const isValid = await verifyPassword(password, user.hashedPassword);
    if (!isValid) {
      registerLoginFailure(ip, email);
      return null;
    }

    clearLoginFailures(ip, email);

    // Actualiza lastLoginAt (best-effort; no bloquea login si falla)
    prisma.user
      .update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })
      .catch(() => {
        /* silencioso: no filtramos detalles internos */
      });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
    };
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const providers: Provider[] = [credentialsProvider];

  const google = await getGoogleAuth().catch(() => null);
  if (google?.enabled && google.clientId && google.clientSecret) {
    providers.push(
      Google({
        clientId: google.clientId,
        clientSecret: google.clientSecret,
        // No pedimos scopes extra: solo identidad básica (email verificado).
        allowDangerousEmailAccountLinking: false,
      }),
    );
  }

  return {
    ...authConfig,
    providers,
    callbacks: {
      ...authConfig.callbacks,
      async signIn({ user, account, profile }) {
        if (account?.provider !== "google") return true;
        // Política: Google NUNCA registra — solo entra quien ya está de alta.
        const email = user.email?.trim().toLowerCase();
        if (!email) return false;
        if (profile && "email_verified" in profile && profile.email_verified === false) {
          return false;
        }
        const dbUser = await prisma.user.findUnique({ where: { email } });
        return !!dbUser?.isActive;
      },
      async jwt({ token, user, account }) {
        // Credentials: `user` trae id/role de authorize().
        if (user && account?.provider !== "google") {
          token.id = user.id as string;
          token.role = user.role as UserRole;
        }
        // Google: mapear el token al usuario de BD (solo en el sign-in).
        if (account?.provider === "google" && user?.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email.trim().toLowerCase() },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role as UserRole;
            prisma.user
              .update({ where: { id: dbUser.id }, data: { lastLoginAt: new Date() } })
              .catch(() => {});
          }
        }
        return token;
      },
    },
  };
});
