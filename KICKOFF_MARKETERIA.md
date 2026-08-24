# KICKOFF — Marketería sobre SpAIder oficial

> Documento de arranque para un **chat nuevo**. Léelo completo antes de tocar nada.
> Objetivo: tomar el **SpAIder oficial** (este repo) como base, **respetar la línea
> de imagen de Marketería**, y **sumarle los extras** que el oficial no tiene
> (Discord, WhatsApp, WordPress). Fecha de handoff: 2026-08-24.

---

## 0 · La decisión (ya tomada por el dueño)

**Path A — Partir del oficial.** El código de este repo es el producto SpAIder
completo (Eskailet Society v1.1). En vez de reconstruir features en el MVP viejo,
**construimos sobre esto** y le portamos 3 extras + la marca Marketería.

- **NO se pierde nada del trabajo previo**: el MVP en Python queda archivado como
  referencia; sus extras se re-expresan aquí (la lógica ya está resuelta).
- El MVP viejo vive en `~/Documents/Proyectos/SpAIder ` (¡ojo, con **espacio final**!)
  y en GitHub `roccogarcini/spaider`. **No borrar.**

---

## 1 · Los dos codebases

| | Este repo (OFICIAL, la base) | MVP viejo (referencia) |
|---|---|---|
| Ruta | `~/Documents/Proyectos/spaider-oficial` | `~/Documents/Proyectos/SpAIder ` (espacio final) |
| Stack | **Next.js 15 + Prisma + next-auth 5 + shadcn/ui**, monolito TS | FastAPI (Python) + SQLAlchemy + Next separado |
| Estado | Producto completo del manual | MVP (~60-70%) + extras |
| Git | **NO tiene .git aún** → hay que `git init` | Repo en `roccogarcini/spaider` |

---

## 2 · Qué YA trae el oficial (no reconstruir)

Modelos Prisma (26): `User, PasswordResetToken, ModelPrice, ApiKey, Source,
Finding, AnalysisRun, Insight, Idea, IdeaComment, BrandProfile, Content,
ContentVersion, Channel, Asset, Agent, LLMProvider, ProcessConfig, AIExecution,
Automation, AutomationRun, ChatSession, ChatMessage, AppSetting, Activity, BackupRun`.

Traducción a features del manual (todo esto **ya está hecho**):
- **Marca** → `BrandProfile` (tono, voz, audiencia, líneas editoriales, qué evitar,
  identidad visual, logo). Rutas `/(dashboard)/marca`, `/api/brand`.
- **Multi-proveedor LLM** → `LLMProvider` (OpenAI, Anthropic, OpenRouter, DeepSeek,
  Gemini, z.ai, custom) + `ModelPrice` (tarifas). Deps: `openai`, `@anthropic-ai/sdk`.
- **Contenido base versionado** → `Content` + `ContentVersion` (editor con versiones).
- **Investigación/Análisis** → `Source`, `Finding`, `AnalysisRun`, `Insight`
  (viralidad/potencialidad, semáforo, enriquecer). Rutas `investigacion`, `analisis`.
- **Ideas** (borrador→propuesta→aprobada→rechazada→archivada), **Producción**, **Creaciones**.
- **Canales** → `Channel` + `Asset`. Carruseles a PNG con **puppeteer**.
- **Chat + Agentes** → `ChatSession/Message`, `Agent`.
- **Automatizaciones** → `Automation/Run` con **node-cron**.
- **Admin**: usuarios (roles ADMIN/EDITOR/VIEWER), Observabilidad (`AIExecution`),
  Consumo IA + presupuesto, **Copias de seguridad** (`BackupRun`, S3/R2),
  **MCP** (`/api/[transport]`, dep `mcp-handler`, 24 tools), **REST API** (`/api/v1`),
  **SMTP** (`nodemailer`) + **Login Google** (`next-auth`).

---

## 3 · Qué le AGREGAMOS (los extras + la marca)

El oficial **NO** trae Discord, WhatsApp ni WordPress. Esos son nuestro valor extra.
Ya están resueltos en el MVP Python — **usar como plano** (re-escribir en TS):

| Extra | Plano (MVP Python) | Cómo encaja en el oficial |
|---|---|---|
| **WordPress** (fuente) | `SpAIder /backend/app/research/providers/wordpress.py` | Nuevo tipo de `Source` + fetch (parecido a RSS). Lo más sencillo. |
| **WhatsApp** (ingesta) | `SpAIder /backend/app/webhooks/{router,security}.py` + `intelligence/service.py::ingest_whatsapp` | Ruta API Next (webhook Meta, verify HMAC) → crea `Finding`/`Insight`. |
| **Discord** (bot) | `SpAIder /backend/app/intelligence/discord_bot.py` + `intelligence/service.py` | Bot con **discord.js** como worker persistente (EasyPanel corre contenedor 24/7). |

Nota: en el MVP estos alimentan "intelligence" (comunidad). Aquí lo natural es que
alimenten la **bandeja de hallazgos** (`Finding`) como una fuente más, o un módulo
"Comunidad" nuevo. Decidir en Fase 3/4.

---

## 4 · LÍNEA DE IMAGEN MARKETERÍA (respetarla — es requisito del dueño)

Del **Manual de Marca Marketería** (PDF en `~/Desktop/Manual MarketrIA.pdf`).

### Colores
| Rol | HEX | HSL aprox (para shadcn `--var`) |
|---|---|---|
| Marino (fondo dominante/tinta) | `#121F4A` | `226 61% 18%` |
| Tinta (casi negro azul) | `#0B1230` | `229 62% 12%` |
| **Lima (acento / "el grito")** | `#DAF04B` | `68 84% 62%` |
| Niebla (gris claro) | `#F2F3F6` | `228 10% 96%` |
| Oliva (lima como texto sobre claro) | `#8A9A18` | `67 73% 35%` |

Reglas: **80% marino / 15% blanco-niebla / 5% lima**. La lima marca lo que importa;
**texto marino sobre lima** (nunca blanco sobre lima). Sobre fondo claro, la lima va
en oliva.

> **Suerte**: el oficial ya usa lima como `--primary` (más pálida, `65 52% 75%`).
> Solo hay que **re-tintar** las variables HSL en `src/app/globals.css` a la paleta
> de arriba (primary→lima `#DAF04B`, background→marino/niebla, ring/accent-deep→oliva).

### Tipografía
- **Anton** → títulos/números (mayúsculas, interlínea ~0.94). Reemplaza a Instrument Serif / Space Grotesk como display.
- **Archivo** → cuerpo/UI. Reemplaza a Geist.
- Se cambia en `src/app/layout.tsx` (imports `next/font/google`) + `tailwind.config.ts` (fontFamily).

### Logo (assets ya copiados en `public/brand/`)
- `marketeria-white.png` → logo blanco (fondos oscuros/marino).
- `marketeria-navy.png` → logo marino (fondos claros/niebla).
- `marketeria-mark.png` / `marketeria-favicon.png` → marca cuadrada (M + triángulo lima) para favicon y sidebar colapsado.
- Regla de marca: aire mínimo = altura de la M; ancho mínimo 90px; triángulo siempre lima cuando el fondo lo permite; sobre lima, logo todo en marino. **No** estirar/rotar/sombra/degradados.
- Además: cargar el logo en **Marca → BrandProfile.logoDataUri** (base64, ≤200KB) y rellenar `visualIdentity` con la paleta, para que las **creaciones/carruseles** salgan con la imagen de marca.

### Nombre
- Cambiar "SpAIder"/"spAIder" → **"Marketería"** en toda la UI, título de pestaña, favicon.
  (El MVP ya hizo este ejercicio; replicar aquí.)

---

## 5 · Roadmap por fases (incremental, cada fase es entregable)

**F0 · Poner a correr el oficial** (medio día)
- `git init` + primer commit del estado base.
- `.env` desde `.env.example` (DB, JWT/secrets, etc.).
- `docker compose up -d` (o `npm i && npx prisma migrate deploy && npm run db:seed && npm run dev`).
- Verificar login + panel en el navegador. Cargar el proveedor OpenAI (créditos YA activos, ver §6).

**F1 · Rebrand Marketería** (~1 día) — *respetar §4*
- Re-tintar `globals.css` (HSL → paleta Marketería), fuentes Anton/Archivo en `layout.tsx`+tailwind.
- Logo en sidebar/login/favicon (assets en `public/brand/`).
- Nombre "SpAIder"→"Marketería" en toda la UI.
- Rellenar **Marca (BrandProfile)** con datos de Marketería (del manual: boutique de comunicación política, tono audaz/directo, etc.) + logoDataUri + visualIdentity.
- Verificar en oscuro y claro.

**F2 · WordPress como fuente** (~1 día) — plano: `wordpress.py`

**F3 · WhatsApp ingesta** (~1-2 días) — plano: `webhooks/` (verify HMAC Meta, fail-closed)

**F4 · Discord bot** (~2-3 días) — plano: `discord_bot.py` (discord.js worker, gating por token/guild)

**F5 · Deploy a EasyPanel** — el oficial trae `DEPLOY_EASYPANEL.md` + `docker-compose.easypanel.yml`.

> Al terminar F1 ya estás "igualado con tu marca". F2-F4 es el "mejorado".

---

## 6 · Datos y credenciales (estado real)

- **OpenAI: créditos YA cargados y funcionando** (se probó en vivo en el MVP: chat,
  ideas y contenido reales). La misma API key sirve aquí — se pega en
  **Admin → Proveedores LLM** (no en chat, el dueño la pega en el panel).
- **Docker Desktop**: instalado (arm64, Rosetta desactivado).
- **gh CLI**: instalado y autenticado como `roccogarcini` (scope repo) → se pueden crear PRs.
- **Homebrew**: instalado en `/opt/homebrew`.
- **Node/Next**: el oficial usa Next 15; verificar versión de Node local o usar Docker.
- **PDFs de referencia**: `~/Desktop/Manual MarketrIA.pdf` (marca) y
  `~/Downloads/MANUAL_SPAIDER.pdf` (manual de usuario del oficial, 37 págs).
- **Leer PDFs**: PyMuPDF + Pillow ya instalados a nivel usuario (`python3`).

---

## 7 · Decisiones abiertas / gotchas

1. **Repo GitHub**: `roccogarcini/spaider` ya es del MVP. Crear **repo nuevo**
   (p.ej. `roccogarcini/marketeria`) para esta base, o renombrar. Decidir en F0.
2. **Nombre de carpeta**: hoy `spaider-oficial`. Se puede renombrar a `marketeria`.
3. **Discord en Next**: necesita proceso vivo → worker separado en el mismo contenedor
   (EasyPanel). No cabe en serverless; con contenedor 24/7 sí.
4. **Dónde caen los extras**: ¿como `Source`/`Finding` (integrados al pipeline) o como
   módulo "Comunidad" aparte? Recomendado: integrarlos como fuentes → aprovechan
   análisis, ideas y producción existentes.
5. **Licencia**: revisar `LICENCIA.md` del oficial antes de publicar/redistribuir.
6. **Gobernanza**: el oficial trae su propio `CLAUDE.md` y `.claude/commands`. Seguir esa.

---

## 8 · Primer mensaje sugerido para el nuevo chat

> "Trabajamos sobre `~/Documents/Proyectos/spaider-oficial` (SpAIder oficial, Next+Prisma).
> Lee `KICKOFF_MARKETERIA.md` completo. Vamos con Path A por fases. Empieza por **F0**:
> git init, configurar `.env`, levantar el stack (Docker o Prisma+seed) y verificar login
> + panel en el navegador. Respeta la línea de marca Marketería (§4) cuando lleguemos a F1.
> No borres el MVP viejo en `SpAIder ` (con espacio)."

---

*Fin del handoff. Todo lo necesario para arrancar está aquí o referenciado.*
