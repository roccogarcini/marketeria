# Non-Functional Requirements — SpAIder

## Performance

- Respuesta UI interactiva < 200 ms (navegación, listados).
- Listados paginados (25/50/100), cap servidor en 500.
- Ejecución IA API: timeout por defecto 60 s, configurable por `ProcessConfig`.
- Dashboard summary: respuesta < 300 ms en DB con seed realista (~200 findings, 50 ideas, 30 contents, 100 assets, 500 AIExecution).

## Security

- Auth: NextAuth v5, JWT httpOnly, bcrypt (12 rondas) para passwords.
- Roles: ADMIN / EDITOR / VIEWER; middleware por ruta y verificación server-side en toda mutación.
- Cifrado: AES-256-GCM para `LLMProvider.encryptedApiKey`; `ENCRYPTION_KEY` obligatoria en arranque.
- Sanitización: Zod en toda entrada; escapado en toda salida markdown render (`rehype-sanitize`).
- Sin hardcoded secrets. `.env.example` sin valores reales, `.env` en `.gitignore`.
- Cumplimiento: quien instala la aplicación es el responsable de los datos que trate con ella. Antes de meter datos de terceros, revisa qué se guarda (fuentes, hallazgos, contenidos) y qué exige el RGPD en tu caso.

## Accessibility

- WCAG 2.1 AA.
- Contraste texto 4.5:1 / UI grande 3:1.
- Focus ring visible en todos los interactivos.
- Navegación completa por teclado (Tab, Enter, Esc).
- `aria-label` en todos los iconos interactivos.
- `prefers-reduced-motion` respetado (sin animaciones de fondo ni auto-scroll).

## Observability

- Logs stdout estructurados (JSON en prod, pretty en dev).
- Tabla `Activity` con todas las acciones de mutación relevantes del pipeline.
- Tabla `AIExecution` con toda ejecución IA y su consumo.
- Dashboard de observabilidad con métricas agregadas y filtros.
- Errores IA capturados y visibles en la UI de la fase correspondiente.

## Scalability

- Asume 1–10 usuarios concurrentes y una sola instancia. PostgreSQL en Docker.
- Crecimiento previsto: hasta 100 ideas activas, 500 contents, 2 000 assets. Índices ya pensados para ese orden.
- La migración a un worker separado (BullMQ/Redis) queda documentada como evolución posible.

## Internationalization

- Interfaz sólo en castellano.

## Browser support

- Chrome, Firefox, Safari, Edge versiones estables -1. Mobile Safari y Chrome Android recientes.

## Data retention

- `AutomationRun.logsText` limitado a 1 MB; runs > 30 días se archivan (flag `isArchived`).
- `ContentVersion`: máximo 20 por content, purga FIFO salvo marcadas hito.
- `Finding` con `status=DISCARDED` puede purgarse a los 90 días (AppSetting `findings_retention_days`).
