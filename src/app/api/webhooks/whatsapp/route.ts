import { NextResponse } from "next/server";
import { getAppSecret, getVerifyToken, getWhatsAppConfig } from "@/lib/whatsapp/config";
import { ingestWhatsAppPayload } from "@/lib/whatsapp/ingest";
import { verifyMetaSignature, verifyToken } from "@/lib/whatsapp/webhook";

/**
 * Webhook público de WhatsApp Cloud API.
 *
 * NO lleva sesión: lo llama Meta desde sus servidores. Lo que lo protege son
 * sus propios secretos — el verify token en el alta y la firma HMAC del cuerpo
 * en cada evento — y por eso está exento en `auth.config.ts`.
 *
 * Todo falla cerrado. Si la integración está apagada o le falta un secreto, se
 * responde 403 sin mirar el cuerpo: un webhook abierto es una puerta para
 * meter hallazgos falsos en la bandeja.
 *
 * Runtime Node (no edge): la verificación de firma usa `node:crypto`.
 */
export const runtime = "nodejs";
// Nada que cachear: cada POST es un evento distinto.
export const dynamic = "force-dynamic";

/**
 * Alta del webhook. Meta llama con `hub.mode=subscribe` y espera el
 * `hub.challenge` DEVUELTO TAL CUAL, en texto plano. Si se envuelve en JSON,
 * Meta rechaza el alta sin decir por qué.
 */
export async function GET(req: Request) {
  const cfg = await getWhatsAppConfig();
  const guardado = await getVerifyToken();
  if (!cfg.enabled || !guardado) {
    return new NextResponse("Webhook de WhatsApp no configurado", { status: 403 });
  }
  const params = new URL(req.url).searchParams;
  const challenge = params.get("hub.challenge") ?? "";
  if (
    params.get("hub.mode") === "subscribe" &&
    verifyToken(params.get("hub.verify_token"), guardado)
  ) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse("Verificación fallida", { status: 403 });
}

export async function POST(req: Request) {
  const cfg = await getWhatsAppConfig();
  const appSecret = await getAppSecret();
  if (!cfg.enabled || !appSecret) {
    return NextResponse.json({ error: "Webhook de WhatsApp no configurado" }, { status: 403 });
  }

  // El cuerpo CRUDO, antes de parsear: el HMAC va sobre esos bytes exactos.
  // Con req.json() y un JSON.stringify después, cualquier diferencia de
  // formato cambia el hash y la firma no cuadra nunca.
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return NextResponse.json({ error: "Payload no es JSON" }, { status: 400 });
  }

  try {
    const r = await ingestWhatsAppPayload(payload);
    return NextResponse.json(r);
  } catch (err) {
    // Un 500 hace que Meta reintente, y el reintento está bien: el dedupe por
    // wamid impide que se dupliquen los que sí entraron.
    console.error("[whatsapp] fallo al guardar los mensajes:", err);
    return NextResponse.json({ error: "Error al guardar los mensajes" }, { status: 500 });
  }
}
