# System Architecture — SpAIder

## Overview

SpAIder es una aplicación monolítica Next.js 15 (App Router) que expone en un mismo proceso:
- **Frontend** (`src/app/(auth)` + `src/app/(dashboard)`) con estilo editorial "papel + lima": fondo papel cálido, acento lima, display serif y etiquetas mono. Light por defecto, dark disponible.
- **API Routes** (`src/app/api/*`) como backend sin servicios adicionales.
- **Persistencia**: Prisma 6 sobre PostgreSQL.
- **Autenticación**: NextAuth v5 con JWT, bcrypt y middleware por rol.
- **Ejecución IA**: router central `lib/ai/router.ts` sobre los SDKs de OpenAI y Anthropic (y compatibles: OpenRouter, z.ai, deepseek).
- **Automatizaciones**: `node-cron` in-process.

Diagrama lógico (capas):

```
┌──────────────────────────────────────────────────────────────┐
│  UI (App Router)                                             │
│  (auth) · (dashboard)/dashboard · /investigacion · /ideas    │
│  /soportes · /chat · /agentes · /automatizaciones            │
│  /modulos/canales · /marca · /admin/*                        │
└──────────────┬───────────────────────────────────────────────┘
               │ server actions + fetch JSON
┌──────────────▼───────────────────────────────────────────────┐
│  API Routes  (src/app/api/*)                                  │
│  ─ auth/*  ─ sources/*  ─ findings/*  ─ analysis/*  ─ ideas/* │
│  ─ brand-profile  ─ contents/*  ─ channels/*  ─ assets/*      │
│  ─ agents/*  ─ automations/*  ─ chat/*                        │
│  ─ ai/execute  ─ ai/executions                                │
│  ─ admin/*  ─ dashboard/summary                               │
└───────┬───────────────┬───────────────┬──────────────────────┘
        │               │               │
 ┌──────▼─────┐  ┌──────▼──────┐ ┌──────▼──────────────────┐
 │  Prisma    │  │ AI Router   │ │ node-cron scheduler     │
 │            │  │ API          │ │ (Automation triggers)   │
 │  Postgres  │  │ OpenAI       │ │                         │
 │            │  │ Anthropic    │ │                         │
 │            │  │ OpenRouter   │ │                         │
 └────────────┘  └──────────────┘ └─────────────────────────┘
```

## Módulos lógicos

### Pipeline editorial (núcleo)
1. **Panel** — `dashboard`, `activity`
2. **Investigación** — `sources`, `findings`, `analysis`, `insights` (`/analisis` redirige aquí)
3. **Ideas** — `ideas`, `idea-comments`, `brand-profile` (singleton), `contents`, `content-versions` (`/produccion` redirige aquí)
4. **Creaciones** — `channels`, `assets`

### Módulos complementarios
- **Agentes** — `agents` (fichas + prompts + modo exec)
- **Automatizaciones** — `automations`, `automation-runs`
- **Chat** — `chat-sessions`, `chat-messages`
- **Administración** — `admin/users`, `admin/providers`, `admin/settings`
- **Seguridad** — auth + middleware + `lib/crypto.ts`
- **Observabilidad** — `dashboard`, `activity`, `ai-executions`

### Ejecución IA (transversal)
- `lib/ai/router.ts`: recibe `{ processType, refType, refId }` y elige proveedor y modelo según preferencia (agente / processConfig / admin global / fallback).
- `lib/ai/api.ts`: wrapper OpenAI / Anthropic / OpenRouter / Custom.
- Toda ejecución registra un `AIExecution` con `executionMode`, tokens, duración y resultado.

## Credential Level Mapping

- **Level 1 (.env, infraestructura)**:
  - `DATABASE_URL` (PostgreSQL)
  - `NEXTAUTH_SECRET`
  - `ENCRYPTION_KEY` (AES-256 para cifrar claves en BBDD)
- **Level 2 (deployment config)**:
  - `NEXTAUTH_URL`
  - `NODE_ENV`
  - `STORAGE_UPLOAD_PATH` (ruta del volumen)
- **Level 3 (admin panel, cifrado en BBDD con AES-256)**:
  - Claves de `LLMProvider` (OpenAI, Anthropic, OpenRouter, Custom)
  - Cualquier token futuro de integración externa

Ninguna clave Level 3 se devuelve nunca completa al frontend: siempre máscara (`sk-****1234`). Rotación desde `/admin/proveedores`.

## Infrastructure

- **BBDD**: PostgreSQL 16 (Docker Compose).
- **Storage**: volumen Docker `./storage/uploads/` montado en el contenedor.
- **Cron**: `node-cron` in-process; toggle global en `AppSetting` (key=`automations_enabled`).
- **Deploy**: Dockerfile multi-stage (`deps → build → runner`), `docker-compose.yml` con services `app` + `db`. Preparado para EasyPanel.
- **Logs**: stdout estructurado + tabla `Activity` para auditoría funcional.
