/**
 * Perfil de marca de Marketería (del Manual de Marca).
 *
 * Vive aparte del seed porque lo usan dos sitios: el seed de una instalación
 * nueva y el script `scripts/aplicar-marca.ts`, que lo escribe sobre una base
 * de datos que ya existe.
 *
 * El logo se guarda como data URI en `logoDataUri` (la marca cuadrada, M
 * blanca sobre marino): es lo que el pipeline pega en las creaciones donde el
 * diseño pone `__BRAND_LOGO__`.
 */
import fs from "node:fs";
import path from "node:path";

export const LINEAS_EDITORIALES = [
  "Estrategia sin humo: cómo se gana una elección de verdad, con datos y no con corazonadas.",
  "IA aplicada a campaña: qué automatizar, qué no tocar nunca y dónde está el ahorro real.",
  "Detrás de la campaña: decisiones difíciles, errores propios y lo que aprendimos de ellos.",
  "Territorio y escucha: lo que dice la calle antes de que lo diga la encuesta.",
  "Comunicación de gobierno: cómo sostener el mensaje cuando ya no hay campaña.",
];

export const MARCA_MARKETERIA = {
  name: "Marketería",
  tone:
    "Audaz y directo, sin rodeos ni palabrería de agencia. Hablamos claro incluso " +
    "cuando la respuesta incomoda. Nada de superlativos vacíos ni de promesas que " +
    "no se puedan medir: si algo no se puede probar, no se dice.",
  voice:
    "Primera persona del plural (nosotros), tuteando al lector. Voz de socio " +
    "estratégico, no de proveedor: opinamos y recomendamos, no ofrecemos un menú. " +
    "Frases cortas, verbos activos, ejemplos concretos antes que conceptos.",
  audience:
    "Candidatas y candidatos, equipos de campaña y áreas de comunicación de " +
    "gobierno en México. Gente con poco tiempo y mucha presión, que necesita " +
    "decidir rápido y con criterio. Leen en el móvil, entre reunión y reunión.",
  editorialLinesJson: JSON.stringify(LINEAS_EDITORIALES),
  mustAvoid:
    "No hacemos partidismo ni atacamos a personas: analizamos estrategia, no " +
    "ideología. Nada de datos de clientes, encuestas internas ni casos " +
    "identificables sin permiso. Nada de promesas de resultado electoral. Sin " +
    "jerga de agencia (sinergia, disruptivo, engagement), sin emojis decorativos " +
    "y sin titulares de miedo o alarmismo.",
  visualIdentity: [
    "PALETA (usar solo estos colores):",
    "· Marino #121F4A — fondo dominante y tinta principal.",
    "· Tinta #0B1230 — fondos más profundos, casi negro azulado.",
    "· Lima #DAF04B — ACENTO. Marca lo que importa y nada más.",
    "· Niebla #F2F3F6 — fondo claro y aire.",
    "· Oliva #8A9A18 — la lima cuando tiene que ser texto sobre fondo claro.",
    "",
    "PROPORCIÓN: 80% marino / 15% blanco-niebla / 5% lima. La lima nunca es fondo",
    "de una pieza entera: es el subrayado, el dato, el botón, la cifra.",
    "",
    "CONTRASTE: sobre lima el texto va SIEMPRE en marino, nunca en blanco.",
    "Sobre marino, texto en niebla o blanco. Sobre niebla, texto en marino.",
    "",
    "TIPOGRAFÍA: títulos y cifras en una condensada de palo, SIEMPRE EN",
    "MAYÚSCULAS e interlínea apretada (~0.94) — Anton es la de marca; si no está",
    "disponible, 'Haettenschweiler', 'Impact', sans-serif condensada. Cuerpo en",
    "Archivo o, en su defecto, la sans del sistema. Nunca serif ni script.",
    "",
    "LOGO: insertar con <img src=\"__BRAND_LOGO__\"> solo cuando se pida. Aire",
    "alrededor de al menos la altura de la M. Ancho mínimo 90px. Nunca estirarlo,",
    "rotarlo, ponerle sombra ni degradados, ni recolorearlo fuera de la paleta.",
    "",
    "ESTILO: geométrico y limpio. Bloques planos, diagonales y triángulos (el",
    "triángulo de la M es la firma). Cifras enormes. Sin degradados, sin sombras",
    "blandas, sin brillos, sin stock fotográfico genérico.",
  ].join("\n"),
};

/** El logo cuadrado (M blanca sobre marino) como data URI base64. */
export function logoDataUri(): string {
  const f = path.join(process.cwd(), "public", "icon-192.png");
  return `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
}
