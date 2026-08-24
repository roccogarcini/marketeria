import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiKeyRateCheck } from "./rate-limit";

/**
 * Autenticación de la API externa (/api/v1/**) y del servidor MCP (/api/mcp).
 *
 * - Claves con formato `spk_<48 hex>`; en BD solo vive su SHA-256 (+ prefijo
 *   visible para identificarlas en el panel). La clave completa se muestra
 *   UNA vez al crearla.
 * - Scopes: "read" (solo lectura) | "read_write" (lectura y escritura).
 * - Se acepta `Authorization: Bearer spk_...` o cabecera `x-api-key`.
 */

export type ApiKeyScope = "read" | "read_write";

export type ApiKeyAuth = {
  keyId: string;
  /** Usuario dueño de la clave — se usa para proveedores LLM y autoría. */
  userId: string;
  scope: ApiKeyScope;
};

export function generateApiKey(): string {
  return `spk_${randomBytes(24).toString("hex")}`;
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, 12) + "…";
}

function extractKey(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  const headerKey = req.headers.get("x-api-key");
  return headerKey?.trim() || null;
}

/** Verifica la clave sin producir una respuesta HTTP (para el MCP). */
export async function verifyApiKey(req: Request): Promise<ApiKeyAuth | null> {
  const key = extractKey(req);
  if (!key || !key.startsWith("spk_")) return null;
  const row = await prisma.apiKey.findUnique({
    where: { hashedKey: hashApiKey(key) },
    select: {
      id: true,
      isActive: true,
      scope: true,
      createdById: true,
      // Si desactivan al usuario dueño, sus claves dejan de valer también.
      createdBy: { select: { isActive: true } },
    },
  });
  if (!row || !row.isActive || !row.createdBy.isActive) return null;
  // lastUsedAt es informativo: fire-and-forget, sin bloquear la petición.
  prisma.apiKey
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return {
    keyId: row.id,
    userId: row.createdById,
    scope: row.scope as ApiKeyScope,
  };
}

/**
 * Guard para route handlers REST. `write: true` exige scope read_write.
 * Devuelve la auth o una NextResponse de error lista para retornar.
 */
export async function requireApiKey(
  req: Request,
  opts: { write?: boolean } = {},
): Promise<ApiKeyAuth | NextResponse> {
  const auth = await verifyApiKey(req);
  if (!auth) {
    return NextResponse.json(
      { error: "API key inválida o ausente. Usa Authorization: Bearer spk_…" },
      { status: 401 },
    );
  }
  const rate = apiKeyRateCheck(auth.keyId);
  if (rate.limited) {
    return NextResponse.json(
      { error: "Rate limit excedido (120 peticiones/minuto por clave)." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }
  if (opts.write && auth.scope !== "read_write") {
    return NextResponse.json(
      { error: "Esta API key es de solo lectura; esta operación requiere scope read_write." },
      { status: 403 },
    );
  }
  return auth;
}
