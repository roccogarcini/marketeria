# Design Summary — SpAIder

## Stack
- Framework: Next.js 15 (App Router) + TypeScript
- UI: Tailwind + shadcn/ui (Radix) + Lucide. **Identidad "papel + lima" (editorial)**: light por defecto, dark disponible.
- State: Zustand + React Hook Form + Zod
- DB: PostgreSQL (dev vía Docker y prod), Prisma 6, ~20 modelos, UUID PKs
- Auth: NextAuth v5, JWT, bcrypt, roles ADMIN/EDITOR/VIEWER
- LLM: 100% API vía router central. OpenAI SDK (OpenAI/OpenRouter/compatibles como z.ai, deepseek) + Anthropic SDK
- Jobs: node-cron in-process
- Deploy: Docker multi-stage + docker-compose, EasyPanel-ready

## Module Map
- API: Next.js Route Handlers en `src/app/api/*` (14 grupos)
- Frontend: 11 páginas en `src/app/(dashboard)/` + `/login`
- Components: `ui/`, `layout/`, `research/`, `analysis/`, `ideas/`, `production/`, `assets/`, `agents/`, `automations/`, `chat/`, `admin/`, `shared/`
- Lib: `lib/ai/{router,api}`, `lib/automations/{runner,scheduler}` (node-cron vía `src/instrumentation.ts`), `lib/net/ssrf-guard`, `lib/crypto`, `lib/db`, `lib/utils`

## Entity Overview
- User — auth, role ADMIN/EDITOR/VIEWER
- Source — MANUAL/URL/RSS → Finding[]
- AnalysisRun → Insight[] (score, tags, oportunidad)
- Idea — DRAFT/PROPOSED/APPROVED/REJECTED/ARCHIVED → Content[]
- BrandProfile (singleton) — tono, voz, líneas editoriales, audiencia
- Content — markdown, status → ContentVersion[] y Asset[]
- Channel → Asset (status PENDING/READY/SCHEDULED/PUBLISHED)
- Agent — system prompt, ejecución vía API
- LLMProvider (AES-256) → ProcessConfig por `processType`
- AIExecution — log por fase (executionMode siempre "API")
- Automation → AutomationRun[]
- ChatSession → ChatMessage[]
- AppSetting, Activity

## Key Patterns
- Pipeline estricto: Idea debe estar APPROVED para crear Content; Content APPROVED para generar Asset
- BrandProfile como singleton (id='default', upsert PUT)
- Ejecución IA centralizada en `/api/ai/execute` → router → proveedor LLM (API)
- AES-256 sobre `ENCRYPTION_KEY` para claves LLM; claves nunca se exponen completas al frontend
- Sistema "papel + lima": fondo papel cálido (`--background` 39 47% 94%) / gris oscuro neutro (hue 220) en dark; acento lima `--primary` 65 52% 75% (HSL triplet para que funcione `bg-primary/X`). Display serif (Instrument Serif), labels mono (JetBrains Mono), números (Space Grotesk), UI (Geist). Tokens en `src/app/globals.css`; fuentes en `src/app/layout.tsx`. Los componentes usan tokens semánticos, así que un cambio de paleta se propaga solo.
- Sidebar con dos bloques: "Pipeline editorial" y "Módulos"; active = lima-wash + borde izquierdo. Logo araña conservado.

## Vocabulario canónico (un término por concepto)
- **Fuentes** (`Source`): de dónde sale la investigación (RSS/URL, Apify, YouTube, Manual). Pantalla: `/investigacion/fuentes`.
- **Hallazgos** (`Finding`): items detectados por las fuentes. Bandeja en `/investigacion`.
- **Ideas** (`Idea`): ideas aprobadas para producir. `/ideas`.
- **Canales** (`Channel`): dónde publicas + su config de adaptación IA (prompt/plantilla/restricciones). Pantalla única `/modulos/canales` (`/soportes/canales` y `/modulos/soportes` redirigen aquí).
- **Creaciones** / **pieza** (`Asset`): contenido adaptado a un canal (output del pipeline). `/soportes` (sección "Creaciones"); cada item es una "pieza".
- Evitar: usar "soporte" (→ canal o pieza), o "investigación" como sinónimo de fuente.

## Credential Map
- Level 1 (.env): DATABASE_URL, NEXTAUTH_SECRET, ENCRYPTION_KEY
- Level 2 (deployment): NEXTAUTH_URL, NODE_ENV, STORAGE_UPLOAD_PATH
- Level 3 (admin panel, AES-256): LLMProvider keys (OPENAI/ANTHROPIC/OPENROUTER/CUSTOM)
