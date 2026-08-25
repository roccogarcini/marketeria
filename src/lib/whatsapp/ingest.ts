import { prisma } from "@/lib/prisma";
import { createFindingIfNew } from "@/lib/research/findings";
import { getSourceId } from "./config";
import { extractMessages, tituloDeMensaje } from "./webhook";

/**
 * Mensajes de WhatsApp → hallazgos de la bandeja de investigación.
 *
 * Se integran como una fuente más y no como un módulo aparte: así heredan
 * análisis, ideación y producción, que es donde está el valor. Un mensaje de
 * un grupo de trabajo es materia prima igual que un artículo de un blog.
 *
 * La deduplicación va por `Finding.externalId` = wamid. Meta reenvía cada
 * evento hasta recibir un 200, así que sin esto un fallo momentáneo llena la
 * bandeja de copias.
 */

export type ResultadoIngesta = {
  recibidos: number;
  creados: number;
  duplicados: number;
};

/** La Source que recibe los mensajes, creándola si aún no existe. */
export async function resolverSource(): Promise<string> {
  const configurada = await getSourceId();
  if (configurada) {
    const existe = await prisma.source.findUnique({
      where: { id: configurada },
      select: { id: true },
    });
    if (existe) return existe.id;
  }
  // Ni configurada ni existente (la borraron): se reutiliza cualquier fuente
  // WHATSAPP antes de crear otra, para no acabar con una por cada reinicio.
  const previa = await prisma.source.findFirst({
    where: { type: "WHATSAPP" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (previa) return previa.id;

  const creada = await prisma.source.create({
    data: {
      name: "WhatsApp",
      type: "WHATSAPP",
      isActive: true,
      externalKey: "whatsapp:webhook",
    },
    select: { id: true },
  });
  return creada.id;
}

export async function ingestWhatsAppPayload(payload: unknown): Promise<ResultadoIngesta> {
  const mensajes = extractMessages(payload);
  const resultado: ResultadoIngesta = {
    recibidos: mensajes.length,
    creados: 0,
    duplicados: 0,
  };
  // Un payload de solo acuses de entrega es lo normal y no debe crear la
  // fuente ni tocar la base de datos.
  if (mensajes.length === 0) return resultado;

  const sourceId = await resolverSource();
  for (const msg of mensajes) {
    const creado = await createFindingIfNew({
      sourceId,
      externalId: msg.externalId,
      title: tituloDeMensaje(msg),
      // Sin URL a propósito: un mensaje de WhatsApp no es una página. Poner
      // una falsa dejaría enlaces rotos por toda la bandeja.
      url: null,
      snippet: msg.text?.slice(0, 800) ?? null,
      fullContent: msg.text ?? null,
      author: msg.authorName ?? msg.from,
      publishedAt: msg.sentAt,
      // El payload íntegro se guarda: si mañana hace falta el id del adjunto o
      // un campo nuevo de Meta, está aquí y no hay que volver a pedirlo.
      rawPayload: JSON.stringify(msg),
      status: "NEW",
    });
    if (creado) resultado.creados++;
    else resultado.duplicados++;
  }
  await prisma.source.update({
    where: { id: sourceId },
    data: { lastFetchedAt: new Date() },
  });
  return resultado;
}
