import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { ApiKeysManager } from "./api-keys-manager";

export const dynamic = "force-dynamic";

/**
 * URL base pública de esta instancia, para mostrar las URLs reales de
 * conexión (MCP y REST). Prioridad: NEXTAUTH_URL (la fija el deploy) →
 * cabeceras del proxy (x-forwarded-*) → host de la petición.
 */
async function resolveBaseUrl(): Promise<string> {
  const env = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");
  if (env) return env;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

export default async function ApiKeysPage() {
  const baseUrl = await resolveBaseUrl();
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scope: true,
      isActive: true,
      lastUsedAt: true,
      createdAt: true,
    },
  });
  return (
    <ApiKeysManager
      baseUrl={baseUrl}
      initial={keys.map((k) => ({
        ...k,
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        createdAt: k.createdAt.toISOString(),
      }))}
    />
  );
}
