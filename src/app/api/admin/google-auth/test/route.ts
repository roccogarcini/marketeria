import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/rbac";
import { getGoogleAuth } from "@/lib/auth/google-auth";

/**
 * POST /api/admin/google-auth/test — valida el par Client ID + Secret contra
 * el endpoint de tokens de Google SIN abrir el flujo OAuth: se envía un code
 * falso y la respuesta distingue credenciales inválidas (invalid_client) de
 * válidas (invalid_grant / redirect_uri_mismatch = el cliente autenticó).
 * Política: admin.
 */
export async function POST() {
  const guard = await requireRole("admin");
  if (guard instanceof NextResponse) return guard;

  const cfg = await getGoogleAuth();
  if (!cfg.clientId || !cfg.clientSecret) {
    return NextResponse.json({
      ok: false,
      error: "Guarda primero el Client ID y el Client Secret.",
    });
  }

  // `/+$`, no `/$`: si NEXTAUTH_URL se pega con más de una barra final, quitar
  // solo una deja la URL de retorno con doble barra y Google la rechaza.
  const origin = process.env.NEXTAUTH_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "spaider-connection-test",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: `${origin}/api/auth/callback/google`,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };

    if (data.error === "invalid_client" || data.error === "unauthorized_client") {
      return NextResponse.json({
        ok: false,
        error: "Client ID o Client Secret incorrectos (Google: invalid_client).",
      });
    }
    // invalid_grant / redirect_uri_mismatch → Google autenticó el cliente:
    // las credenciales son válidas (el code falso es lo único rechazado).
    return NextResponse.json({
      ok: true,
      detail: "Credenciales válidas — Google reconoce el cliente.",
    });
  } catch (err) {
    console.error("[google-auth/test]:", err);
    return NextResponse.json({
      ok: false,
      error: "No se pudo contactar con Google (red del servidor).",
    });
  }
}
