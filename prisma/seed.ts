/**
 * SpAIder — seed de instalación NUEVA.
 *
 * SOLO corre sobre una base de datos vacía. Si detecta usuarios, canales,
 * agentes o fuentes existentes, aborta SIN tocar nada (no destructivo).
 *
 * El primer ADMIN sale de las variables de entorno ADMIN_EMAIL y
 * ADMIN_PASSWORD (las mismas que usa scripts/bootstrap-admin.mjs en el
 * arranque del contenedor). Este seed NUNCA crea usuarios con contraseñas
 * conocidas/hardcodeadas.
 *
 * Estado tras ejecutar sobre BD vacía:
 *   PIPELINE EDITORIAL (mínimo, demo limpia):
 *     · 3 fuentes (1 RSS, 1 URL, 1 IA) + 3 hallazgos (1 por fuente)
 *     · 1 idea APROBADA ("seleccionada")
 *     · 1 contenido + 1 creación (asset) a partir de esa idea
 *
 *   PRECONFIGURACIÓN:
 *     · 4 agentes con system prompts y modos preconfigurados
 *     · 3 canales de EJEMPLO (LinkedIn, Newsletter, Instagram Carrusel)
 *     · 3 automatizaciones cron + 4 runs históricas
 *     · 2 chat sessions ejemplo
 *     · BrandProfile singleton con la marca de Marketería (paleta, tono, logo)
 *     · AppSettings + 1 usuario ADMIN (desde env)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { MARCA_MARKETERIA, logoDataUri } from "./marca-marketeria";

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

// ─────────────────────────────────────────────────────────────────────────
// GUARD — el seed solo puebla BD vacías. Con datos existentes, aborta.
// ─────────────────────────────────────────────────────────────────────────

async function assertEmptyDatabase() {
  const [users, channels, agents, sources] = await Promise.all([
    prisma.user.count(),
    prisma.channel.count(),
    prisma.agent.count(),
    prisma.source.count(),
  ]);
  const total = users + channels + agents + sources;
  if (total > 0) {
    console.log(
      `→ La base de datos ya tiene datos (${users} usuarios, ${channels} canales, ` +
        `${agents} agentes, ${sources} fuentes). Seed omitido: no se toca nada.`
    );
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────
// USERS · BRAND · SETTINGS  (infra, upsert)
// ─────────────────────────────────────────────────────────────────────────

async function seedAdminFromEnv() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error(
      "✗ Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD en el entorno.\n" +
        "  El seed no crea usuarios con contraseñas por defecto: define ambas\n" +
        "  variables y vuelve a ejecutar, p. ej.:\n" +
        "    ADMIN_EMAIL=tu@email.com ADMIN_PASSWORD='una-password-segura' npm run db:seed"
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("✗ ADMIN_PASSWORD debe tener al menos 8 caracteres.");
    process.exit(1);
  }
  const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", role: "ADMIN", hashedPassword, isActive: true },
  });
  console.log(`  ✓ ADMIN creado desde el entorno: ${email}`);
  return admin;
}

async function seedBrandProfile() {
  // Placeholders genéricos: cada instalación define su marca desde /marca.
  // `update: {}` a propósito: si la marca ya está escrita, un re-seed no la
  // pisa. Para forzar la actualización: scripts/aplicar-marca.ts.
  await prisma.brandProfile.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", ...MARCA_MARKETERIA, logoDataUri: logoDataUri() },
  });
  console.log("  ✓ BrandProfile de Marketería listo (paleta, tono y logo del manual).");
}

async function seedAppSettings() {
  const settings: Array<{ key: string; value: unknown; category: string }> = [
    { key: "automations_enabled", value: true, category: "automations" },
    { key: "findings_retention_days", value: 90, category: "general" },
  ];
  for (const s of settings) {
    await prisma.appSetting.upsert({
      where: { key: s.key },
      update: { value: JSON.stringify(s.value), category: s.category },
      create: {
        key: s.key,
        value: JSON.stringify(s.value),
        category: s.category,
      },
    });
  }
  console.log(`  ✓ ${settings.length} AppSettings listos.`);
}

// ─────────────────────────────────────────────────────────────────────────
// PRECONFIGURACIÓN · AGENTES (4)
// ─────────────────────────────────────────────────────────────────────────

async function seedAgents() {
  const agents = [
    {
      slug: "analista-editorial",
      name: "Analista de Sector",
      role: "Extrae insights del sector de tu marca (novedades, movimientos, patrones)",
      systemPrompt:
        "Eres un analista del sector de tu marca. Convierte señales dispersas (novedades, lanzamientos, publicaciones de referencia) en insights accionables para un equipo de contenido. Devuelve JSON estructurado cuando se te pida.",
      temperature: 0.4,
      icon: "brain",
    },
    {
      slug: "redactor-marca",
      name: "Redactor de Marca",
      role: "Produce contenido largo con ejemplos concretos, respetando el BrandProfile",
      systemPrompt:
        "Eres un redactor senior. Produces markdown listo para publicar. Respetas el BrandProfile: cero hype, mucho caso real, opinión clara. Siempre que introduzcas un concepto, incluye un ejemplo concreto que lo ilustre.",
      temperature: 0.6,
      icon: "feather",
    },
    {
      slug: "adaptador-canal",
      name: "Adaptador de Canal",
      role: "Adapta el contenido a LinkedIn, Twitter, Newsletter sin perder precisión",
      systemPrompt:
        "Adaptas contenido largo a canales concretos. Respetas las restricciones de cada canal sin diluir la precisión ni perder el ángulo original. Si un canal no admite el formato original, lo resumes conservando el ejemplo que lo sostiene.",
      temperature: 0.5,
      icon: "share-2",
    },
    {
      slug: "ideador",
      name: "Ideador Estratégico",
      role: "Transforma insights en ideas editoriales priorizadas",
      systemPrompt:
        "Eres un director editorial. Lees insights del sector de tu marca y propones 3-5 ideas de contenido con ángulo, rationale, canal sugerido y estimación de esfuerzo. Priorizas ideas que demuestren criterio sobre las que solo buscan clicks.",
      temperature: 0.7,
      icon: "lightbulb",
    },
  ];
  for (const a of agents) {
    await prisma.agent.create({
      data: {
        slug: a.slug,
        name: a.name,
        role: a.role,
        systemPrompt: a.systemPrompt,
        temperature: a.temperature,
        maxTokens: 2500,
        icon: a.icon,
        isActive: true,
      },
    });
  }
  console.log(`  ✓ ${agents.length} agentes listos.`);
}

// ─────────────────────────────────────────────────────────────────────────
// PRECONFIGURACIÓN · CANALES DE EJEMPLO (3) — cada instalación crea los suyos
// ─────────────────────────────────────────────────────────────────────────

async function seedChannels() {
  const CAROUSEL_SYSTEM_PROMPT = `Eres un diseñador que produce carruseles para Instagram en formato HTML estático listo para capturar como PNG.

--- FORMATO ---
- Cada slide es un archivo HTML independiente: slide1.html, slide2.html, etc.
- Tamaño: 1080x1080 (formato 1x1 cuadrado)
- Número de slides: 8-13 según el tema (usa el número que mejor encaje)
- El output debe devolver CADA fichero HTML COMPLETO, separado por marcadores exactos:
  === slide1.html ===
  <!DOCTYPE html>...
  === slide2.html ===
  ...
  === convert.js ===
  (script puppeteer)
  === copy.md ===
  (copy Instagram + hashtags)

--- SISTEMA DE COLOR ---
- Usa la paleta de la marca (BrandProfile o constraints del canal) si está definida.
- Si no hay paleta definida: fondo neutro (claro u oscuro), texto de alto contraste
  y UN solo color de acento aplicado con moderación en titulares y elementos clave.
- Mantén la coherencia: la misma paleta en todas las slides del carrusel.

--- ESTILO VISUAL BASE (OBLIGATORIO EN TODAS LAS SLIDES) ---
1. Una fuente legible de Google Fonts para titulares y body (pesos 400, 700, 900)
2. Fuente secundaria: monospace del sistema para labels técnicos, datos y código
3. Frame consistente en las 4 esquinas (monospace pequeño, color tenue):
   - Arriba izquierda: número de slide "01 ///"
   - Arriba derecha: fecha "MES AAAA /"
   - Abajo izquierda: "/ NOMBRE NEGOCIO"
   - Abajo derecha: "@handle /"
4. Contador de slide centrado arriba: "2/13" (monospace pequeño, discreto)

--- GRÁFICO CSS EN CADA SLIDE (NO NEGOCIABLE) ---
Cada slide DEBE tener al menos un elemento visual hecho con CSS puro. Prohibido solo texto. Elige según el contenido: barras comparativas, terminal mockup, bloque de código con syntax highlighting, diagramas de flujo con nodos conectados, timelines, gauges conic-gradient, escalas con steps, grids estilizadas, shapes clip-path, checklist con estados, etc.

--- JERARQUÍA TIPOGRÁFICA ---
Portada: etiqueta arriba (monospace 18px, letter-spacing:3px) · título 82-120px, font-weight:900, letter-spacing:-4px · subtítulo monospace 32-36px en color secundario.
Slides contenido: "/// 01 · CATEGORÍA" (monospace 20px) · título 58-64px, font-weight:900 · body 24-28px, line-height:1.55 · strong en color de máximo contraste, weight 700.
Cierre: remate o CTA en caja con borde sutil.

--- ESTRUCTURA NARRATIVA ---
Slide 1 PORTADA: gancho fuerte + gráfico CSS impactante
Intermedios: UNA IDEA POR SLIDE, texto breve + gráfico
Final: remate sorprendente o CTA genuino

--- VOZ Y TONO ---
Sigue el BrandProfile de la instalación. Frases cortas mezcladas con alguna larga. Opiniones claras. Sin relleno.
PROHIBIDO: frases de coaching ("sal de tu zona de confort"), urgencia artificial, marketing agresivo, "Sabías que..." o "En un mundo donde...".

--- OUTPUT ADICIONAL ---
Después de los slides.html incluye un fichero convert.js con puppeteer-core que exporte a PNG (viewport 1080x1080, deviceScaleFactor:2). Y un copy.md con 3-5 párrafos cortos para Instagram + pregunta al final + 5-10 hashtags.`;

  const CAROUSEL_TEMPLATE_MD = `# Ejemplo de estructura esperada

Tema: [se sustituye por el title del Content]
Ángulo: [extraído del rationale de la idea]

## Marca (sustituye por los datos de TU marca)
- Nombre negocio: Tu marca
- Handle Instagram: @tumarca
- Audiencia: define aquí tu audiencia

## Número de slides
8-13 según el contenido. Portada + intermedios con una idea por slide + cierre con CTA.

## Nota
El agente debe devolver los slides HTML completos con el frame de marca y al menos un gráfico CSS por slide (nada de solo texto).`;

  // Canales de EJEMPLO: renómbralos o bórralos y crea los de tu marca.
  const channels = [
    {
      id: "seed-ch-linkedin",
      name: "LinkedIn (ejemplo)",
      type: "LINKEDIN",
      sortOrder: 1,
      constraints: { maxLength: 1300, format: "text-only" },
      template: null,
      systemPrompt:
        "Adaptas el contenido a un post de LinkedIn de hasta 1300 caracteres: gancho en la primera línea, párrafos de 1-2 frases, cierre con una pregunta o CTA suave. Máximo 3 hashtags. Respeta el tono y la voz del BrandProfile.",
    },
    {
      id: "seed-ch-newsletter",
      name: "Newsletter (ejemplo)",
      type: "NEWSLETTER",
      sortOrder: 2,
      constraints: { maxLength: 800 },
      template: null,
      systemPrompt:
        "Adaptas el contenido a una edición breve de newsletter (hasta 800 palabras): asunto claro que resuma el valor, apertura directa sin rodeos, 2-3 secciones cortas con la idea central y un cierre con enlace o CTA. Respeta el tono y la voz del BrandProfile.",
    },
    {
      id: "seed-ch-instagram",
      name: "Instagram Carrusel (ejemplo)",
      type: "CAROUSEL",
      sortOrder: 3,
      constraints: {
        format: "carousel-html",
        dimensions: "1080x1080",
        slides: { min: 8, max: 13 },
        brand: {
          businessName: "Tu marca",
          handle: "@tumarca",
          audience: "define aquí tu audiencia",
        },
      },
      template: CAROUSEL_TEMPLATE_MD,
      systemPrompt: CAROUSEL_SYSTEM_PROMPT,
    },
  ];
  for (const c of channels) {
    await prisma.channel.create({
      data: {
        id: c.id,
        name: c.name,
        type: c.type,
        sortOrder: c.sortOrder,
        isActive: true,
        constraintsJson: c.constraints ? JSON.stringify(c.constraints) : null,
        templateMarkdown: c.template,
        systemPrompt: c.systemPrompt,
      },
    });
  }
  console.log(`  ✓ ${channels.length} canales de ejemplo listos.`);
}

// ─────────────────────────────────────────────────────────────────────────
// PIPELINE EDITORIAL · DEMO MÍNIMA
// 3 fuentes / 3 hallazgos / 1 idea APROBADA / 1 contenido / 1 creación (asset)
// ─────────────────────────────────────────────────────────────────────────

async function seedMinimalEditorialDemo(adminId: string) {
  // 3 fuentes — IDs estables: las automatizaciones cron las referencian.
  const sources = [
    {
      id: "seed-src-rss-marketing",
      name: "Anthropic Engineering Blog",
      type: "RSS",
      url: "https://www.anthropic.com/engineering/rss",
    },
    {
      id: "seed-src-url-cmo",
      name: "MCP Registry — nuevos servidores",
      type: "URL",
      url: "https://registry.modelcontextprotocol.io/latest",
    },
    {
      id: "seed-src-manual-team",
      name: "Señales internas del equipo",
      type: "AI_RESEARCH",
      url: null,
      configJson: JSON.stringify({
        brief:
          "Busca señales sobre adopción de Claude Code, skills y MCPs en equipos de desarrollo: casos con métricas, ahorros medidos y patrones de uso interno.",
      }),
    },
  ];
  for (const s of sources) {
    await prisma.source.create({
      data: {
        id: s.id,
        name: s.name,
        type: s.type,
        url: s.url,
        configJson: "configJson" in s ? s.configJson : null,
        isActive: true,
        lastFetchedAt: new Date(Date.now() - 12 * 3_600_000),
      },
    });
  }
  console.log(`  ✓ ${sources.length} fuentes listas.`);

  // 3 hallazgos — uno por fuente. Status NEW = aparecen en la bandeja.
  const findings = [
    {
      id: "demo-find-1",
      srcId: "seed-src-rss-marketing",
      title: "Sonnet 4.6 mejora editing multi-fichero un 34%",
      url: "https://www.anthropic.com/news/sonnet-4-6",
      snippet:
        "Benchmarks internos de Anthropic muestran reducción de errores en refactors que tocan 5+ ficheros.",
      summary:
        "Anthropic publica benchmarks comparando Sonnet 4.5 y 4.6 en 120 tareas reales de edición multi-fichero. El nuevo modelo reduce un 34% los errores de sintaxis y un 22% el tiempo de corrección post-generación. El salto se concentra en refactors >5 ficheros y en secuencias de tools encadenadas (+11% fiabilidad).",
      author: "Anthropic Engineering Team",
      daysAgo: 2,
      reach: 48200,
      likes: 1820,
      comments: 142,
      shares: 387,
    },
    {
      id: "demo-find-2",
      srcId: "seed-src-url-cmo",
      title: "MCP de Supabase alcanza 10k descargas en el registry",
      url: "https://registry.modelcontextprotocol.io/servers/supabase",
      snippet:
        "El servidor oficial de Supabase se consolida como referencia para CRUD directo desde Claude.",
      summary:
        "El MCP oficial de Supabase supera 10.000 descargas en el MCP Registry. Ventaja clave: en lugar de SQL crudo (error-prone), invoca tools tipadas sobre la schema real. Casos publicados: automatización de migraciones, asistentes de admin panel y análisis exploratorios sobre datos de producción con tools de solo-lectura.",
      author: "Supabase DevRel",
      daysAgo: 4,
      reach: 38700,
      likes: 1540,
      comments: 98,
      shares: 312,
    },
    {
      id: "demo-find-3",
      srcId: "seed-src-manual-team",
      title: "SRE ahorró 40h/mes con 3 skills internos",
      url: null,
      snippet:
        "Primera vez que medimos ahorro con números concretos. Merece pieza firmada por el head of SRE.",
      summary:
        "Primera medición con números reales del impacto de skills internos en nuestro equipo SRE. Los 3 skills (diagnose-alert, compare-runbook, post-incident-draft) ahorran 40 h/mes medidas sobre 8 semanas. El head of SRE propone firmar una pieza explicando cómo llegamos aquí — primer caso interno con ROI verificable.",
      author: "Head of SRE · interno",
      daysAgo: 4,
      reach: 0,
      likes: 0,
      comments: 0,
      shares: 0,
    },
  ];
  for (const f of findings) {
    await prisma.finding.create({
      data: {
        id: f.id,
        sourceId: f.srcId,
        title: f.title,
        url: f.url,
        snippet: f.snippet,
        summary: f.summary,
        author: f.author,
        publishedAt: new Date(Date.now() - f.daysAgo * 86_400_000),
        reach: f.reach || null,
        likes: f.likes || null,
        comments: f.comments || null,
        shares: f.shares || null,
        status: "NEW",
        fetchedAt: new Date(Date.now() - (f.daysAgo - 0.5) * 86_400_000),
      },
    });
  }
  console.log(`  ✓ ${findings.length} hallazgos listos.`);

  // 1 idea APROBADA = "seleccionada".
  const ideaId = "demo-idea-1";
  await prisma.idea.create({
    data: {
      id: ideaId,
      insightId: null,
      title: "Manifiesto: IA como extensión del developer, no su reemplazo",
      angle: "ANGLE",
      rationale:
        "Pieza fundacional de ~1800 palabras firmada por el CTO. Defendemos los skills como herramientas que amplifican el criterio del dev, no que lo sustituyen. Antídoto contra la narrativa de reemplazo que satura el feed.",
      status: "APPROVED",
      viralityScore: 0.85,
      viralityReason:
        "Tema caliente con mucha fatiga: un manifiesto técnico con firma humana destaca entre el hype y se comparte como referencia de debate. Genera comentarios largos de otros CTOs.",
      potentialScore: 0.92,
      potentialReason:
        "Define posicionamiento de marca y atrae perfiles senior (CTOs, VPs de ingeniería). Se cita en otros posts, genera tráfico orgánico de larga cola y refuerza autoridad en el nicho de AI engineering.",
      idealFormat: "Post opinión LinkedIn",
      referenceUrl: "https://www.anthropic.com/news/sonnet-4-6",
      createdById: adminId,
      decidedById: adminId,
      decidedAt: new Date(),
    },
  });
  console.log(`  ✓ 1 idea APROBADA lista (la "seleccionada").`);

  // 1 contenido linkado a la idea + 1 creación (asset) en LinkedIn.
  const contentId = "demo-content-1";
  const contentBody = `# IA como extensión del developer

## Lo que NO vamos a hacer

- Publicar skills sin evals.
- Reemplazar el criterio del dev: amplificarlo.
- Perseguir métricas de tokens ahorrados por encima del impacto real.

## Nuestros 5 principios

1. Un skill no reemplaza una decisión: la acelera.
2. Todo skill lleva evals mínimas y owner humano.
3. Priorizamos skills componibles frente a monolíticos.
4. Transparentamos qué hacemos con IA y qué no.
5. Medimos por horas devueltas al dev, no por prompts ejecutados.

## Cómo lo aplicamos hoy

Cada skill que entra en producción cruza una checklist con esos 5 puntos. Si falla en cualquiera, vuelve al borrador. No salimos a publicar nada que no podamos explicar a un dev senior con un café.`;

  await prisma.content.create({
    data: {
      id: contentId,
      ideaId,
      title: "IA como extensión del developer",
      body: contentBody,
      status: "APPROVED",
      currentVersion: 1,
      createdById: adminId,
    },
  });
  await prisma.contentVersion.create({
    data: {
      contentId,
      version: 1,
      body: contentBody,
      notes: "Versión inicial generada a partir del rationale de la idea.",
      isMilestone: true,
      createdById: adminId,
    },
  });

  await prisma.asset.create({
    data: {
      contentId,
      channelId: "seed-ch-linkedin",
      body:
        "5 principios para integrar IA en ingeniería sin perder criterio humano.\n\n" +
        "1. Un skill no reemplaza una decisión: la acelera.\n" +
        "2. Sin evals → no sale a producción.\n" +
        "3. Componible > monolítico.\n" +
        "4. Transparencia sobre qué hace cada skill.\n" +
        "5. Medimos en horas devueltas, no en tokens ahorrados.\n\n" +
        "Manifiesto completo en el blog.",
      status: "READY",
      aiExecutionMode: "API",
    },
  });
  console.log(`  ✓ 1 contenido + 1 creación (asset LinkedIn) listos.`);
}

// ─────────────────────────────────────────────────────────────────────────
// PRECONFIGURACIÓN · AUTOMATIZACIONES (3) + RUNS (4)
// ─────────────────────────────────────────────────────────────────────────

async function seedAutomations(adminId: string) {
  const automations = [
    {
      id: "seed-auto-fetch-mw",
      name: "Fetch Anthropic Engineering Blog",
      triggerType: "SCHEDULED",
      cron: "0 */6 * * *",
      targetType: "SOURCE",
      paramsJson: JSON.stringify({ sourceId: "seed-src-rss-marketing" }),
      isActive: false,
    },
    {
      id: "seed-auto-fetch-cmi",
      name: "Scan MCP Registry diario",
      triggerType: "SCHEDULED",
      cron: "30 7 * * *",
      targetType: "SOURCE",
      paramsJson: JSON.stringify({ sourceId: "seed-src-url-cmo" }),
      isActive: true,
    },
    {
      id: "seed-auto-manual-team",
      name: "Refresco señales internas (IA)",
      triggerType: "MANUAL",
      cron: null,
      targetType: "SOURCE",
      paramsJson: JSON.stringify({ sourceId: "seed-src-manual-team" }),
      isActive: true,
    },
  ];
  for (const a of automations) {
    // createdById: las ejecuciones programadas leen las credenciales del creador
    await prisma.automation.create({ data: { ...a, createdById: adminId } });
  }

  const runs = [
    {
      id: "seed-auto-run-1",
      automationId: "seed-auto-fetch-cmi",
      status: "SUCCESS",
      logs: "[SOURCE] created=4 skipped=12 error=none — 4 nuevos MCPs indexados",
      daysAgo: 0,
    },
    {
      id: "seed-auto-run-2",
      automationId: "seed-auto-fetch-cmi",
      status: "SUCCESS",
      logs: "[SOURCE] created=2 skipped=14 error=none",
      daysAgo: 1,
    },
    {
      id: "seed-auto-run-3",
      automationId: "seed-auto-manual-team",
      status: "SUCCESS",
      logs: "[SOURCE] created=1 skipped=0 error=none — 1 nota nueva del equipo",
      daysAgo: 2,
    },
    {
      id: "seed-auto-run-4",
      automationId: "seed-auto-fetch-cmi",
      status: "ERROR",
      logs: "ERROR: HTTP 503 registry.modelcontextprotocol.io",
      daysAgo: 3,
    },
  ];
  for (const r of runs) {
    await prisma.automationRun.create({
      data: {
        id: r.id,
        automationId: r.automationId,
        status: r.status,
        logsText: r.logs,
        startedAt: new Date(Date.now() - r.daysAgo * 86_400_000 - 60_000),
        finishedAt: new Date(Date.now() - r.daysAgo * 86_400_000),
      },
    });
  }
  console.log(`  ✓ ${automations.length} automatizaciones + ${runs.length} runs históricas.`);
}

// ─────────────────────────────────────────────────────────────────────────
// PRECONFIGURACIÓN · CHAT SESSIONS (2)
// ─────────────────────────────────────────────────────────────────────────

async function seedChatSessions(adminId: string) {
  const sessions = [
    {
      id: "seed-chat-1",
      userId: adminId,
      title: "Ayuda a diseñar un skill para triage de issues",
      messages: [
        { role: "user", content: "¿Puedes darme 3 formas de estructurar un skill que haga triage automático de issues de GitHub?" },
        { role: "assistant", content: "1) Skill monolítico con tool de GitHub: prompt clasifica + etiqueta en un paso.\n2) Skill componible: un subagent por área (bug, feature, docs) que decide en paralelo.\n3) Skill + hook: PostToolUse sobre el crear-issue dispara clasificación automática.\n\n¿Cuál te encaja con tu volumen de issues/día?" },
        { role: "user", content: "Me quedo con la 3. Desarrolla con código." },
        { role: "assistant", content: "Estructura básica en `.claude/hooks/triage.sh`:\n```bash\n#!/usr/bin/env bash\nISSUE_ID=$1\nclaude --skill=triage-issue --ref=$ISSUE_ID --print > /tmp/triage.json\ngh issue edit $ISSUE_ID --add-label \"$(jq -r '.labels[]' /tmp/triage.json)\"\n```\nEl skill `triage-issue` (en `.claude/skills/triage-issue/SKILL.md`) recibe el ID y devuelve JSON con severity + labels + assignee sugerido." },
      ],
    },
    {
      id: "seed-chat-2",
      userId: adminId,
      title: "¿Qué MCP usamos para integrar con Stripe?",
      messages: [
        { role: "user", content: "Dame 3 opciones de MCP para integrar Stripe en Claude Code y una recomendación." },
        { role: "assistant", content: "1) MCP oficial de Stripe (beta): cubre Charges, Customers, Subscriptions pero no Connect ni Tax.\n2) MCP genérico HTTP con OpenAPI de Stripe: máxima flexibilidad, más mantenimiento.\n3) MCP custom propio: solo si necesitas Stripe Connect + marketplace.\n\n**Recomendación**: si tu caso es billing estándar (subs + invoices), ve con el 1. Si tienes marketplace, custom (3). Evita el 2 salvo que necesites features que el oficial aún no tiene." },
      ],
    },
  ];
  for (const s of sessions) {
    await prisma.chatSession.create({
      data: {
        id: s.id,
        userId: s.userId,
        title: s.title,
        messages: {
          create: s.messages.map((m, idx) => ({
            role: m.role,
            content: m.content,
            // Asistente = generado por IA (vía proveedor LLM). User no se marca.
            aiExecutionMode: m.role === "assistant" ? "API" : null,
            createdAt: new Date(Date.now() - (s.messages.length - idx) * 60_000),
          })),
        },
      },
    });
  }
  console.log(`  ✓ ${sessions.length} chat sessions listas.`);
}

// ─────────────────────────────────────────────────────────────────────────
// OBSERVABILIDAD · historial de ejecuciones IA (modo API)
// ─────────────────────────────────────────────────────────────────────────

async function seedAIExecutions() {
  const MODELS = [
    "gpt-4o-mini",
    "claude-3-5-sonnet-20241022",
    "glm-4.6",
    "deepseek-chat",
    "openai/gpt-4o-mini",
  ];
  const PHASES = [
    "RESEARCH",
    "ANALYSIS",
    "IDEATION",
    "PRODUCTION",
    "ASSET",
    "CHAT",
  ] as const;

  const now = Date.now();
  const rows = Array.from({ length: 16 }).map((_, i) => {
    const phase = PHASES[i % PHASES.length];
    const model = MODELS[i % MODELS.length];
    // 2 errores controlados; el resto SUCCESS.
    const isError = i === 4 || i === 11;
    const inputTokens = 280 + ((i * 137) % 2600);
    const outputTokens = isError ? 0 : 120 + ((i * 211) % 3200);
    return {
      phase,
      executionMode: "API",
      status: isError ? "ERROR" : "SUCCESS",
      modelUsed: model,
      errorMessage: isError
        ? "No hay proveedor LLM activo de tipo OPENAI. Añádelo en /admin/proveedores."
        : null,
      durationMs: isError ? 3200 + i * 90 : 1400 + ((i * 523) % 14000),
      inputTokens: isError ? null : inputTokens,
      outputTokens: isError ? null : outputTokens,
      // repartidas en los últimos ~12 días
      createdAt: new Date(now - i * 18 * 3600 * 1000),
    };
  });

  for (const r of rows) {
    await prisma.aIExecution.create({ data: r });
  }
  console.log(`  ✓ ${rows.length} ejecuciones IA (modo API) para observabilidad.`);
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  console.log("→ Seed SpAIder (instalación nueva: preconfig + demo editorial mínima)");

  // Guard no destructivo: nunca tocar una BD con datos.
  if (!(await assertEmptyDatabase())) return;

  const admin = await seedAdminFromEnv();
  await seedBrandProfile();
  await seedAppSettings();
  await seedAgents();
  await seedChannels();
  await seedMinimalEditorialDemo(admin.id);
  await seedAutomations(admin.id);
  await seedChatSessions(admin.id);
  await seedAIExecutions();

  console.log("→ Seed completado.");
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
