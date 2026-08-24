import {
  Linkedin,
  Twitter,
  Instagram,
  Facebook,
  Mail,
  BookOpen,
  FileText,
  Newspaper,
  Globe,
  Images,
  BarChart3,
  Mic,
  Film,
  Youtube,
  MessageCircle,
  Megaphone,
  Share2,
  type LucideIcon,
} from "lucide-react";

/**
 * Catálogo completo de tipos de Soporte (Channel) del pipeline editorial.
 * Cada tipo lleva: etiqueta humana, icono, descripción corta, y defaults
 * de systemPrompt + constraints cuando se crea un canal de ese tipo.
 *
 * El `type` del Channel en la DB es una string libre — esta lista define
 * qué valores ofrecemos desde el UI y cómo los presentamos.
 */

export type ChannelTypeDef = {
  id: string;
  label: string;
  group: "Texto" | "Social" | "Visual" | "Vídeo / Audio" | "Email / Ads" | "Otro";
  icon: LucideIcon;
  description: string;
  /** Prompt por defecto que se sugiere al crear un canal de este tipo. */
  systemPromptDefault: string;
  /** Restricciones por defecto. JSON stringificado al guardar. */
  constraintsDefault: Record<string, unknown>;
};

export const CHANNEL_TYPES: ChannelTypeDef[] = [
  // ── Texto / web ─────────────────────────────────────────────────
  {
    id: "BLOG",
    label: "Blog",
    group: "Texto",
    icon: BookOpen,
    description: "Artículo largo de blog con estructura h1/h2, intro, desarrollo y conclusión.",
    systemPromptDefault:
      "Adapta el contenido a formato de blog post. Estructura: H1, párrafo intro gancho, 3-5 H2 con desarrollo, conclusión con CTA.",
    constraintsDefault: { minWords: 800, maxWords: 2500, tone: "profesional" },
  },
  {
    id: "NEWSLETTER",
    label: "Newsletter",
    group: "Texto",
    icon: Mail,
    description: "Email de newsletter con asunto, apertura, cuerpo y CTA.",
    systemPromptDefault:
      "Formato newsletter: línea de asunto, preheader, apertura personal, bloques de cuerpo con subtítulos, firma con CTA.",
    constraintsDefault: { maxWords: 600, tone: "cercano" },
  },
  {
    id: "LANDING_PAGE",
    label: "Landing page",
    group: "Texto",
    icon: Globe,
    description: "Copy para landing: hero, propuesta de valor, features, social proof, CTA.",
    systemPromptDefault:
      "Escribe copy de landing page: hero con título + subtítulo, 3 features con beneficio, testimonio, CTA primario.",
    constraintsDefault: { maxWords: 400, tone: "directo" },
  },
  {
    id: "PRESS_RELEASE",
    label: "Nota de prensa",
    group: "Texto",
    icon: Newspaper,
    description: "Nota de prensa con lead invertido (qué·quién·cuándo·dónde·por qué).",
    systemPromptDefault:
      "Escribe una nota de prensa profesional con titular, lead invertido (5W1H), 2-3 párrafos de desarrollo, cita de portavoz, boilerplate y contacto.",
    constraintsDefault: { maxWords: 500, tone: "formal" },
  },

  // ── Social — posts de texto ─────────────────────────────────────
  {
    id: "LINKEDIN",
    label: "LinkedIn",
    group: "Social",
    icon: Linkedin,
    description: "Post largo de LinkedIn con hook + cuerpo + hashtags.",
    systemPromptDefault:
      "Post de LinkedIn: hook fuerte en la primera línea, párrafos cortos, bullets con emojis moderados, CTA al final, 3-5 hashtags.",
    constraintsDefault: { maxChars: 3000, hashtagsMax: 5 },
  },
  {
    id: "TWITTER",
    label: "X / Twitter (hilo)",
    group: "Social",
    icon: Twitter,
    description: "Hilo de X/Twitter con tweets numerados y hook.",
    systemPromptDefault:
      "Hilo de X: primer tweet = hook con promesa, 5-10 tweets de desarrollo, último tweet con CTA. Cada tweet ≤ 280 chars.",
    constraintsDefault: { maxCharsPerTweet: 280, minTweets: 4, maxTweets: 12 },
  },
  {
    id: "FACEBOOK",
    label: "Facebook",
    group: "Social",
    icon: Facebook,
    description: "Post de Facebook con hook visual y CTA.",
    systemPromptDefault:
      "Post de Facebook: hook narrativo en las primeras 2 líneas, cuerpo conversacional, emojis moderados, CTA claro.",
    constraintsDefault: { maxChars: 2000 },
  },
  {
    id: "INSTAGRAM_POST",
    label: "Instagram (caption)",
    group: "Social",
    icon: Instagram,
    description: "Caption de Instagram para feed con hook + cuerpo + hashtags.",
    systemPromptDefault:
      "Caption de Instagram: hook visual en línea 1, cuerpo con storytelling, bloques cortos, 10-15 hashtags al final.",
    constraintsDefault: { maxChars: 2200, hashtagsMax: 15 },
  },
  {
    id: "THREADS",
    label: "Threads",
    group: "Social",
    icon: MessageCircle,
    description: "Post nativo de Threads, tono conversacional.",
    systemPromptDefault:
      "Post de Threads: tono conversacional, ≤ 500 chars, sin hashtags excesivos. Pregunta abierta al final para generar replies.",
    constraintsDefault: { maxChars: 500 },
  },

  // ── Visual ──────────────────────────────────────────────────────
  {
    id: "CAROUSEL",
    label: "Carrusel (multi-slide)",
    group: "Visual",
    icon: Images,
    description: "Carrusel de 5-12 slides HTML listo para exportar a PNG.",
    systemPromptDefault:
      "Produce un carrusel HTML. Marcadores `=== slide01.html ===` ... `=== slideN.html ===`. Slide 1 portada con hook, slides 2-N puntos, último slide CTA.",
    constraintsDefault: { minSlides: 5, maxSlides: 12, dimensions: "1080x1080" },
  },
  {
    id: "INFOGRAPHIC",
    label: "Infografía",
    group: "Visual",
    icon: BarChart3,
    description: "Texto base para una infografía: título + bloques con datos.",
    systemPromptDefault:
      "Escribe el texto base para una infografía: título impactante, 4-6 bloques con un dato + 1 frase explicativa por bloque, fuente al pie.",
    constraintsDefault: { blocks: "4-6" },
  },

  // ── Vídeo / Audio — guiones ─────────────────────────────────────
  {
    id: "VIDEO_SCRIPT",
    label: "Guion vídeo hablado",
    group: "Vídeo / Audio",
    icon: Film,
    description:
      "Guion para vídeo hablado genérico (talking head, explainer, a cámara).",
    systemPromptDefault:
      "Guion para vídeo hablado. Formato: [DURACIÓN ESTIMADA], [HOOK 0-5s], [PUNTOS DE VALOR con marcas de tiempo aproximadas], [CTA final]. Escribe como se debe decir, frases cortas, directas, pausas entre ideas.",
    constraintsDefault: { durationSec: 60, tone: "directo", pov: "segunda persona" },
  },
  {
    id: "TIKTOK_SCRIPT",
    label: "Guion TikTok",
    group: "Vídeo / Audio",
    icon: Film,
    description: "Guion vertical para TikTok con hook agresivo en los primeros 3s.",
    systemPromptDefault:
      "Guion TikTok 15-60s. HOOK en segundo 1 (pregunta o afirmación fuerte). 3-4 beats con b-roll sugerido entre corchetes. CTA final 'sígueme para más'.",
    constraintsDefault: { durationSec: 45, hookWindow: 3 },
  },
  {
    id: "REEL_SCRIPT",
    label: "Guion Reel (IG/FB)",
    group: "Vídeo / Audio",
    icon: Film,
    description: "Guion para Instagram/Facebook Reels 15-90s.",
    systemPromptDefault:
      "Guion Reel 30-60s. HOOK visual + verbal en 0-3s. 2-3 puntos de valor con indicaciones de plano entre corchetes [CLOSE UP, CUT TO, B-ROLL]. Final con CTA suave.",
    constraintsDefault: { durationSec: 45 },
  },
  {
    id: "YOUTUBE_SHORT_SCRIPT",
    label: "Guion YouTube Short",
    group: "Vídeo / Audio",
    icon: Youtube,
    description: "Guion vertical para YouTube Shorts <60s.",
    systemPromptDefault:
      "Guion YouTube Short ≤60s. Hook de retención en 0-2s. Un punto central. CTA 'suscríbete'. Indicaciones de plano entre corchetes.",
    constraintsDefault: { durationSec: 55 },
  },
  {
    id: "YOUTUBE_LONG_SCRIPT",
    label: "Guion YouTube (formato largo)",
    group: "Vídeo / Audio",
    icon: Youtube,
    description: "Guion largo 5-15 min para YouTube con intro, capítulos, outro.",
    systemPromptDefault:
      "Guion YouTube largo 8-12 min. Estructura: intro (hook + promesa + roadmap), 3-5 capítulos con marcas de tiempo, transiciones, outro con CTA + end screen. Escribe como se dice, incluye indicaciones de plano y b-roll [entre corchetes].",
    constraintsDefault: { durationMin: 10 },
  },
  {
    id: "PODCAST_SCRIPT",
    label: "Guion podcast",
    group: "Vídeo / Audio",
    icon: Mic,
    description: "Guion de podcast con intro, bloques temáticos y cierre.",
    systemPromptDefault:
      "Guion podcast 15-30 min. Cold open con hook, intro del episodio, 3-4 bloques con preguntas guía, cierre con resumen + CTA. Estilo hablado natural.",
    constraintsDefault: { durationMin: 25 },
  },

  // ── Email / Ads ────────────────────────────────────────────────
  {
    id: "EMAIL",
    label: "Email directo",
    group: "Email / Ads",
    icon: Mail,
    description: "Email outbound/transaccional individual (no broadcast).",
    systemPromptDefault:
      "Email directo: asunto + primera línea gancho, cuerpo en 3 párrafos cortos, CTA único, firma.",
    constraintsDefault: { maxWords: 200 },
  },
  {
    id: "AD_COPY",
    label: "Copy de anuncio",
    group: "Email / Ads",
    icon: Megaphone,
    description: "Copy para anuncios (Meta Ads, LinkedIn Ads, Google Search).",
    systemPromptDefault:
      "Copy de anuncio. Entrega 3 variantes: Titular (≤40 chars), Texto principal (≤125 chars), Descripción (≤30 chars). Incluye un beneficio claro y un CTA.",
    constraintsDefault: { variants: 3 },
  },

  // ── Otro ────────────────────────────────────────────────────────
  {
    id: "CUSTOM",
    label: "Personalizado",
    group: "Otro",
    icon: Share2,
    description: "Canal libre sin plantilla. Define tú el prompt y las constraints.",
    systemPromptDefault: "",
    constraintsDefault: {},
  },
];

export const CHANNEL_TYPE_BY_ID: Record<string, ChannelTypeDef> = Object.fromEntries(
  CHANNEL_TYPES.map((c) => [c.id, c]),
);

/** Icono para un type. Si el type no está en el catálogo, cae al fallback. */
export function iconForChannelType(type: string): LucideIcon {
  const def = CHANNEL_TYPE_BY_ID[type.toUpperCase()];
  return def?.icon ?? Share2;
}

/** Etiqueta humana para un type. */
export function labelForChannelType(type: string): string {
  const def = CHANNEL_TYPE_BY_ID[type.toUpperCase()];
  return def?.label ?? type;
}

/** Lista agrupada para renderizar el Select con optgroups. */
export function groupedChannelTypes(): Record<string, ChannelTypeDef[]> {
  const out: Record<string, ChannelTypeDef[]> = {};
  for (const t of CHANNEL_TYPES) {
    (out[t.group] ??= []).push(t);
  }
  return out;
}

export const CHANNEL_TYPE_GROUPS_ORDER: ChannelTypeDef["group"][] = [
  "Texto",
  "Social",
  "Visual",
  "Vídeo / Audio",
  "Email / Ads",
  "Otro",
];
