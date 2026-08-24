# Stack Selection — SpAIder

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Framework | Next.js 15 (App Router) + TypeScript | Full-stack en un único despliegue: una sola build, un solo contenedor. |
| UI | Tailwind CSS + shadcn/ui (Radix) + Lucide | Componentes accesibles sobre tokens semánticos: cambiar la paleta no toca los componentes. |
| State | Zustand + React Hook Form + Zod | Zustand para wizards/tableros ligeros, RHF + Zod para validación robusta. |
| Database | PostgreSQL 16 + Prisma 6 | Mismo motor en local y en el servidor, con concurrencia real. Prisma cubre el 100 % del CRUD. |
| Auth | NextAuth v5 + JWT + bcrypt | Sesión propia sin servicio externo. Roles `ADMIN` / `EDITOR` / `VIEWER`. |
| Markdown | react-markdown + remark-gfm | Edición y renderizado de contenidos y plantillas de soportes. |
| LLM | OpenAI SDK + Anthropic SDK | Multi-proveedor por API: OpenAI, Anthropic, OpenRouter y compatibles. |
| Jobs | `node-cron` in-process | Automatizaciones por cron dentro del mismo servicio Next.js, sin worker separado. |
| Storage | Filesystem local (`./storage/uploads/`) en volumen Docker | Sin servicio externo que contratar; la migración a S3 queda documentada. |
| Deploy | Docker multi-stage + docker-compose | Un único artefacto reproducible. EasyPanel-ready. |

## Alternativas descartadas

- Express + React separados → más overhead y fricción de build.
- Base de datos embebida en fichero → sin concurrencia real, inadecuada para las automatizaciones.
- BullMQ / Redis para jobs → innecesario con el cron in-process; queda como evolución si el volumen lo exige.
- i18n multi-idioma → no aporta valor con la interfaz en castellano.
- Object storage externo (S3/R2) → no aporta frente al volumen local persistido.
