import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  extractMessages,
  tituloDeMensaje,
  verifyMetaSignature,
  verifyToken,
} from "../../src/lib/whatsapp/webhook.ts";

/**
 * Webhook de WhatsApp Cloud API.
 *
 * Es un endpoint PÚBLICO: no hay sesión que lo proteja, solo la firma. Por eso
 * lo que más se prueba aquí es que falla cerrado — sin secreto, sin cabecera,
 * con la firma de otro cuerpo o con el prefijo cambiado, se rechaza. Si algo
 * de esto se colara, cualquiera podría meter hallazgos falsos en la bandeja.
 */

const SECRETO = "un-app-secret-de-meta";
const CUERPO = JSON.stringify({ object: "whatsapp_business_account", entry: [] });

function firmar(cuerpo: string, secreto = SECRETO): string {
  return "sha256=" + crypto.createHmac("sha256", secreto).update(cuerpo, "utf8").digest("hex");
}

// ── Firma de los eventos ────────────────────────────────────────────────────

test("una firma correcta se acepta", () => {
  assert.equal(verifyMetaSignature(CUERPO, firmar(CUERPO), SECRETO), true);
});

test("sin secreto configurado se rechaza: no se acepta por defecto", () => {
  assert.equal(verifyMetaSignature(CUERPO, firmar(CUERPO), null), false);
  assert.equal(verifyMetaSignature(CUERPO, firmar(CUERPO), ""), false);
});

test("sin cabecera de firma se rechaza", () => {
  assert.equal(verifyMetaSignature(CUERPO, null, SECRETO), false);
  assert.equal(verifyMetaSignature(CUERPO, "", SECRETO), false);
});

test("una firma hecha con OTRO secreto se rechaza", () => {
  assert.equal(verifyMetaSignature(CUERPO, firmar(CUERPO, "otro-secreto"), SECRETO), false);
});

test("cambiar un byte del cuerpo invalida la firma", () => {
  const firma = firmar(CUERPO);
  assert.equal(verifyMetaSignature(CUERPO + " ", firma, SECRETO), false);
});

test("el prefijo sha1= no cuela: Meta firma con sha256", () => {
  const hex = crypto.createHmac("sha256", SECRETO).update(CUERPO).digest("hex");
  assert.equal(verifyMetaSignature(CUERPO, `sha1=${hex}`, SECRETO), false);
  assert.equal(verifyMetaSignature(CUERPO, hex, SECRETO), false);
});

test("una firma que no es hexadecimal de 64 se rechaza sin comparar", () => {
  assert.equal(verifyMetaSignature(CUERPO, "sha256=", SECRETO), false);
  assert.equal(verifyMetaSignature(CUERPO, "sha256=zzzz", SECRETO), false);
});

test("la firma en mayúsculas se acepta: el hex es el mismo", () => {
  assert.equal(verifyMetaSignature(CUERPO, firmar(CUERPO).toUpperCase().replace("SHA256=", "sha256="), SECRETO), true);
});

// ── Token del alta ──────────────────────────────────────────────────────────

test("el token del alta solo pasa si coincide, y nunca si falta alguno", () => {
  assert.equal(verifyToken("secreto", "secreto"), true);
  assert.equal(verifyToken("secreto", "otro"), false);
  assert.equal(verifyToken(null, "secreto"), false);
  assert.equal(verifyToken("secreto", null), false);
  assert.equal(verifyToken("", ""), false);
});

// ── Payload ─────────────────────────────────────────────────────────────────

function payload(messages: unknown[], contacts: unknown[] = []) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "5215500000000" },
              contacts,
              messages,
            },
          },
        ],
      },
    ],
  };
}

test("un mensaje de texto se normaliza con autor, fecha y contenido", () => {
  const [m] = extractMessages(
    payload(
      [
        {
          id: "wamid.ABC",
          from: "5215511112222",
          type: "text",
          timestamp: "1756060000",
          text: { body: "La calle está pidiendo otra cosa" },
        },
      ],
      [{ wa_id: "5215511112222", profile: { name: "Sofía" } }],
    ),
  );
  assert.equal(m.externalId, "wamid.ABC");
  assert.equal(m.authorName, "Sofía");
  assert.equal(m.text, "La calle está pidiendo otra cosa");
  assert.equal(m.sentAt?.toISOString(), new Date(1756060000 * 1000).toISOString());
});

test("de una imagen se guarda el pie y la REFERENCIA al adjunto, no el adjunto", () => {
  const [m] = extractMessages(
    payload([
      {
        id: "wamid.IMG",
        from: "521",
        type: "image",
        timestamp: "1756060000",
        image: { id: "media-999", mime_type: "image/jpeg", caption: "El cartel de ayer" },
      },
    ]),
  );
  assert.equal(m.text, "El cartel de ayer");
  assert.equal(m.mediaId, "media-999");
});

test("una ubicación se guarda legible, con nombre y coordenadas", () => {
  const [m] = extractMessages(
    payload([
      {
        id: "wamid.LOC",
        from: "521",
        type: "location",
        timestamp: "1756060000",
        location: { latitude: 19.7, longitude: -101.19, name: "Plaza Morelia" },
      },
    ]),
  );
  assert.equal(m.text, "Plaza Morelia (19.7,-101.19)");
});

test("la respuesta a un botón guarda el texto de la opción pulsada", () => {
  const [m] = extractMessages(
    payload([
      {
        id: "wamid.INT",
        from: "521",
        type: "interactive",
        timestamp: "1756060000",
        interactive: { type: "button_reply", button_reply: { id: "si", title: "Sí, me interesa" } },
      },
    ]),
  );
  assert.equal(m.text, "Sí, me interesa");
});

test("los acuses de entrega no son contenido: se ignoran sin crear nada", () => {
  const soloEstados = {
    entry: [
      {
        changes: [
          {
            value: {
              statuses: [{ id: "wamid.X", status: "delivered", timestamp: "1756060000" }],
            },
          },
        ],
      },
    ],
  };
  assert.deepEqual(extractMessages(soloEstados), []);
});

test("un mensaje sin id se descarta: sin wamid no hay forma de deduplicarlo", () => {
  assert.deepEqual(
    extractMessages(payload([{ from: "521", type: "text", text: { body: "hola" } }])),
    [],
  );
});

test("un tipo desconocido no se pierde: se guarda aunque venga sin texto", () => {
  const [m] = extractMessages(
    payload([{ id: "wamid.NEW", from: "521", type: "reaction", timestamp: "1756060000" }]),
  );
  assert.equal(m.externalId, "wamid.NEW");
  assert.equal(m.text, null);
  assert.equal(m.type, "reaction");
});

test("un payload roto o vacío no revienta: devuelve lista vacía", () => {
  assert.deepEqual(extractMessages(null), []);
  assert.deepEqual(extractMessages("no soy un objeto"), []);
  assert.deepEqual(extractMessages({}), []);
  assert.deepEqual(extractMessages({ entry: "roto" }), []);
});

test("una marca de tiempo inservible deja la fecha a null, no un Invalid Date", () => {
  const [m] = extractMessages(
    payload([{ id: "wamid.T", from: "521", type: "text", timestamp: "ayer", text: { body: "x" } }]),
  );
  assert.equal(m.sentAt, null);
});

// ── Título del hallazgo ─────────────────────────────────────────────────────

test("el título lleva quién escribe y qué dijo, para distinguirlos en la bandeja", () => {
  const t = tituloDeMensaje({
    externalId: "1", from: "521", authorName: "Sofía",
    text: "  Dos    líneas\n aquí ", type: "text", mediaId: null, sentAt: null,
  });
  assert.equal(t, "WhatsApp · Sofía: Dos líneas aquí");
});

test("un adjunto sin pie se etiqueta por su tipo en vez de quedarse en blanco", () => {
  const t = tituloDeMensaje({
    externalId: "1", from: "5215511112222", authorName: null,
    text: null, type: "image", mediaId: "media-1", sentAt: null,
  });
  assert.equal(t, "WhatsApp · 5215511112222: [image]");
});
