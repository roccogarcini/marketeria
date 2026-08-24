import { z } from "zod";

/**
 * Validación compartida del perfil de marca (singleton id 'default').
 * La usan el PUT de sesión (/api/brand — reemplazo completo, como el panel
 * /marca), el PUT de la API externa (/api/v1/brand — actualización parcial)
 * y la tool MCP update_brand — mismas reglas por campo en los tres sitios.
 */
const brandFields = {
  name: z.string().min(1).max(200),
  tone: z.string().max(2000).nullable(),
  voice: z.string().max(2000).nullable(),
  audience: z.string().max(2000).nullable(),
  editorialLines: z.array(z.string().max(400)).max(30),
  mustAvoid: z.string().max(4000).nullable(),
  // Identidad visual: colores hex, tipografía/estilo, handle… Se inyecta en
  // los prompts de diseño (carruseles y adaptación a canal).
  visualIdentity: z.string().max(4000).nullable(),
  // Logo pequeño como data URI base64 (solo png/jpeg/webp — SVG excluido por
  // riesgo XSS). ~200KB de imagen ≈ 270k chars en base64.
  logoDataUri: z
    .string()
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, {
      message: "El logo debe ser un data URI base64 de PNG, JPEG o WebP",
    })
    .max(300_000, { message: "El logo no puede superar ~200KB" })
    .nullable(),
};

/** PUT de sesión (panel /marca): name obligatorio, el resto se reemplaza. */
export const brandPutSchema = z.object({
  name: brandFields.name,
  tone: brandFields.tone.optional(),
  voice: brandFields.voice.optional(),
  audience: brandFields.audience.optional(),
  editorialLines: brandFields.editorialLines.optional(),
  mustAvoid: brandFields.mustAvoid.optional(),
  visualIdentity: brandFields.visualIdentity.optional(),
  logoDataUri: brandFields.logoDataUri.optional(),
});

/**
 * Actualización parcial (API externa y MCP): solo cambia los campos enviados.
 * El shape editorial (sin logo) es el que expone la tool MCP update_brand;
 * el PUT REST añade logoDataUri para paridad total con el panel.
 */
export const brandUpdateShape = {
  name: brandFields.name.optional(),
  tone: brandFields.tone.optional(),
  voice: brandFields.voice.optional(),
  audience: brandFields.audience.optional(),
  editorialLines: brandFields.editorialLines.optional(),
  mustAvoid: brandFields.mustAvoid.optional(),
  visualIdentity: brandFields.visualIdentity.optional(),
};

export const brandUpdateSchema = z.object({
  ...brandUpdateShape,
  logoDataUri: brandFields.logoDataUri.optional(),
});

export type BrandUpdate = z.infer<typeof brandUpdateSchema>;
