import crypto from "node:crypto";

/**
 * Webhook de WhatsApp Cloud API (Meta).
 *
 * Este módulo es puro: verifica firmas y traduce el payload de Meta a algo que
 * el pipeline entiende. No toca la base de datos ni lee configuración, para
 * que se pueda probar con payloads de verdad sin levantar nada.
 *
 * Dos secretos, dos momentos distintos:
 *  - `verify_token`: solo en el alta. Meta hace un GET con `hub.challenge` y
 *    hay que devolverlo tal cual si el token coincide.
 *  - `app_secret`:  en cada evento. Meta firma el CUERPO CRUDO con
 *    HMAC-SHA256 y lo manda en `X-Hub-Signature-256`.
 *
 * Todo falla cerrado: sin secreto configurado, sin cabecera o con firma que no
 * cuadra, se rechaza. Un webhook público sin firma verificada es un endpoint
 * por el que cualquiera mete hallazgos falsos en la bandeja.
 */

const PREFIJO_FIRMA = "sha256=";

/** Tipos de mensaje que traen adjunto. El adjunto NO se descarga: se guarda su id. */
const TIPOS_CON_MEDIA = new Set(["image", "video", "audio", "document", "sticker"]);

export type MensajeWhatsApp = {
  /** wamid: el id de Meta. Es la clave de deduplicación. */
  externalId: string;
  /** Teléfono de quien escribe. */
  from: string | null;
  /** Nombre del perfil, cuando Meta lo manda. */
  authorName: string | null;
  /** Texto del mensaje, el pie de una imagen, la opción pulsada… */
  text: string | null;
  type: string | null;
  /** Id del adjunto en la Graph API. Referencia, no contenido. */
  mediaId: string | null;
  sentAt: Date | null;
};

/**
 * Compara dos cadenas en tiempo constante.
 *
 * `timingSafeEqual` revienta si los buffers miden distinto, y esa excepción ya
 * filtra la longitud del secreto. Se comparan los digest SHA-256, que siempre
 * miden lo mismo.
 */
function igualSinFiltrarTiempo(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** ¿El token del alta coincide con el guardado? Falla cerrado si falta alguno. */
export function verifyToken(recibido: string | null, guardado: string | null): boolean {
  if (!recibido || !guardado) return false;
  return igualSinFiltrarTiempo(recibido, guardado);
}

/**
 * ¿La firma de Meta cuadra con el cuerpo recibido?
 *
 * El HMAC va sobre el cuerpo CRUDO, byte a byte. Si se recalcula sobre el
 * objeto ya parseado y vuelto a serializar, cualquier diferencia de formato
 * (espacios, orden de claves, escapes) cambia el hash y la verificación falla
 * siempre.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | null,
): boolean {
  if (!appSecret || !signatureHeader?.startsWith(PREFIJO_FIRMA)) return false;
  const recibida = signatureHeader.slice(PREFIJO_FIRMA.length);
  if (!/^[0-9a-f]{64}$/i.test(recibida)) return false;
  const esperada = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return igualSinFiltrarTiempo(esperada.toLowerCase(), recibida.toLowerCase());
}

/** Meta manda los segundos de época, y como cadena. */
function parseTimestamp(value: unknown): Date | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n * 1000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function objeto(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function lista(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function texto(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Saca el texto y la referencia al adjunto según el tipo de mensaje.
 * Lo que no se reconoce se guarda igual (con texto null): que llegue un tipo
 * nuevo de Meta no es motivo para perder el mensaje.
 */
function contenido(msg: Record<string, unknown>, tipo: string | null): {
  text: string | null;
  mediaId: string | null;
} {
  if (tipo === "text") return { text: texto(objeto(msg.text).body), mediaId: null };
  if (tipo && TIPOS_CON_MEDIA.has(tipo)) {
    const media = objeto(msg[tipo]);
    // Solo la referencia: descargar el adjunto exige un token de Graph y
    // guardar binarios de terceros. Con el id se puede recuperar después.
    return { text: texto(media.caption), mediaId: texto(media.id) };
  }
  if (tipo === "location") {
    const loc = objeto(msg.location);
    const lat = loc.latitude;
    const lng = loc.longitude;
    const nombre = texto(loc.name);
    const coords =
      typeof lat === "number" && typeof lng === "number" ? `${lat},${lng}` : null;
    return { text: nombre && coords ? `${nombre} (${coords})` : (nombre ?? coords), mediaId: null };
  }
  if (tipo === "button") return { text: texto(objeto(msg.button).text), mediaId: null };
  if (tipo === "interactive") {
    const inter = objeto(msg.interactive);
    const reply = objeto(objeto(inter.button_reply).title ? inter.button_reply : inter.list_reply);
    return { text: texto(reply.title), mediaId: null };
  }
  return { text: null, mediaId: null };
}

/**
 * Payload de Meta → mensajes.
 *
 * Meta usa el MISMO webhook para los acuses de entrega (`statuses`), que llegan
 * por cada mensaje enviado y no son contenido: esos se ignoran en silencio.
 * Un mensaje sin `id` también se descarta: sin wamid no hay forma de
 * deduplicarlo y el reenvío de Meta lo metería repetido en cada intento.
 */
export function extractMessages(payload: unknown): MensajeWhatsApp[] {
  const out: MensajeWhatsApp[] = [];
  for (const entry of lista(objeto(payload).entry)) {
    for (const change of lista(objeto(entry).changes)) {
      const value = objeto(objeto(change).value);
      const nombres = new Map<string, string>();
      for (const c of lista(value.contacts)) {
        const contacto = objeto(c);
        const waId = texto(contacto.wa_id);
        const nombre = texto(objeto(contacto.profile).name);
        if (waId && nombre) nombres.set(waId, nombre);
      }
      for (const m of lista(value.messages)) {
        const msg = objeto(m);
        const externalId = texto(msg.id);
        if (!externalId) continue;
        const tipo = texto(msg.type);
        const from = texto(msg.from);
        const { text, mediaId } = contenido(msg, tipo);
        out.push({
          externalId,
          from,
          authorName: from ? (nombres.get(from) ?? null) : null,
          text,
          type: tipo,
          mediaId,
          sentAt: parseTimestamp(msg.timestamp),
        });
      }
    }
  }
  return out;
}

/**
 * Título del hallazgo: WhatsApp no tiene titulares, así que se compone uno
 * legible para la bandeja. Sin esto, la lista se llena de filas idénticas y no
 * hay forma de distinguir un mensaje de otro sin abrirlo.
 */
export function tituloDeMensaje(msg: MensajeWhatsApp): string {
  const quien = msg.authorName ?? msg.from ?? "desconocido";
  const cuerpo = msg.text?.replace(/\s+/g, " ").trim();
  if (cuerpo) return `WhatsApp · ${quien}: ${cuerpo}`.slice(0, 300);
  const etiqueta = msg.mediaId ? (msg.type ?? "adjunto") : (msg.type ?? "mensaje");
  return `WhatsApp · ${quien}: [${etiqueta}]`.slice(0, 300);
}
