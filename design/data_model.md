# Data Model — SpAIder

UUID v4 como clave primaria en todas las entidades. `createdAt` / `updatedAt` implícitos en todas salvo donde se indique.

## Auth

### User
```
id: uuid (PK)
email: string (unique)
hashedPassword: string (bcrypt)
name: string
role: string  -- ADMIN | EDITOR | VIEWER
isActive: bool (default true)
lastLoginAt: datetime?
createdAt, updatedAt
```
Relaciones: `llmProviders[]`, `processConfigs[]`, `chatSessions[]`, `ideaComments[]`.

### PasswordResetToken
```
id, userId (FK User)
hashedToken: string (unique)  -- hash del token enviado por email
expiresAt: datetime
usedAt: datetime?
createdAt
```
Token de un solo uso para restablecer la contraseña. Índice: `(userId)`.

### ApiKey
```
id, name: string
prefix: string  -- primeros caracteres visibles (spk_xxxx…)
hashedKey: string (unique)  -- SHA-256 de la clave completa
scope: string  -- read | read_write
isActive: bool (default true)
createdById (FK User), lastUsedAt: datetime?, createdAt
```
Clave de acceso a la API externa (`/api/v1`, `/api/mcp`); la clave completa sólo se muestra al crearla. Índice: `(isActive)`.

---

## Pipeline — Fase 1 Investigación

### Source
```
id, name: string, type: string  -- MANUAL | URL | RSS
url: string?
configJson: string?  -- headers, selectors, opciones de parseo
frequencyCron: string?  -- null = solo manual
isActive: bool (default true)
lastFetchedAt: datetime?
```
Relaciones: `findings[]`.

### Finding
```
id, sourceId (FK Source)
title: string
url: string?
snippet: string?
rawPayload: string?  -- JSON stringified del origen
fetchedAt: datetime
status: string  -- NEW | DISCARDED | SENT_TO_ANALYSIS
tagsJson: string?
```
Índice: `(status, fetchedAt desc)`.

---

## Pipeline — Fase 2 Análisis e Inteligencia

### AnalysisRun
```
id, name: string?, agentId?: (FK Agent)
findingIdsJson: string  -- array de finding.id
modelUsed: string?
executionMode: string  -- API
status: string  -- RUNNING | SUCCESS | ERROR
summary: string?  -- texto generado con patrones/oportunidades
durationMs: int?
errorMessage: string?
createdAt
```
Relaciones: `insights[]`.

### Insight
```
id, analysisRunId (FK)
title: string
description: string
relevanceScore: float  -- 0..1
opportunityType: string?  -- TREND | ANGLE | GAP | RISK
tagsJson: string?
clustersJson: string?
```

---

## Pipeline — Fase 3 Gestión de Ideas

### Idea
```
id, insightId?: (FK Insight)
title: string
angle: string?
rationale: string?
status: string  -- DRAFT | PROPOSED | APPROVED | REJECTED | ARCHIVED
feedback: string?
decidedById?: (FK User)
decidedAt: datetime?
createdById: (FK User)
createdAt, updatedAt
```
Índice: `(status, updatedAt desc)`.
Relaciones: `comments[]`, `contents[]`.

### IdeaComment
```
id, ideaId (FK), userId (FK User), body: string, createdAt
```

---

## Pipeline — Fase 4 Producción (con marca)

### BrandProfile (singleton — un único registro forzado por código)
```
id (fijo: 'default'), name: string, tone: string?
voice: string?, audience: string?
editorialLinesJson: string?  -- array
mustAvoid: string?
updatedAt
```
Reglas: la API `PUT /api/brand-profile` hace upsert sobre id = `'default'`. No se admite `POST`.

### Content
```
id, ideaId (FK Idea)
title: string, body: string  -- markdown
status: string  -- DRAFT | IN_REVIEW | APPROVED | REJECTED
currentVersion: int (default 1)
createdById (FK User), createdAt, updatedAt
```
Relaciones: `versions[]`, `assets[]`.

### ContentVersion
```
id, contentId (FK)
version: int
body: string  -- markdown
notes: string?
isMilestone: bool (default false)
createdById (FK User)
createdAt
```
Índice: `(contentId, version desc)`.

---

## Pipeline — Fase 5 Gestión de Soportes

### Channel
```
id, name: string
type: string  -- LINKEDIN | BLOG | NEWSLETTER | INSTAGRAM | TWITTER | CUSTOM
constraintsJson: string?  -- maxLength, format, tone
templateMarkdown: string?
isActive: bool (default true)
sortOrder: int
```

### Asset
```
id, contentId (FK), channelId (FK)
body: string  -- markdown adaptado
mediaPathsJson: string?
status: string  -- PENDING | READY | SCHEDULED | PUBLISHED
scheduledAt: datetime?
notes: string?
createdAt, updatedAt
```
Unique: `(contentId, channelId)` — un asset por combinación.

---

## Módulos — Agentes y Ejecución IA

### Agent
```
id, slug: string (unique), name, role: string
systemPrompt: string
allowedToolsJson: string?
executionMode: string  -- API
providerId?: (FK LLMProvider)
modelId: string?
temperature: float (default 0.7)
maxTokens: int (default 2000)
icon: string?  -- lucide icon name
isActive: bool
```

### LLMProvider
```
id, userId (FK User)
providerType: string  -- OPENAI | ANTHROPIC | OPENROUTER | CUSTOM
displayName: string
encryptedApiKey: string  -- AES-256
baseUrl: string?
isActive: bool
createdAt, updatedAt
unique: (userId, providerType)
```

### ProcessConfig
```
id, userId (FK User)
processType: string  -- RESEARCH | ANALYSIS | IDEATION | PRODUCTION | ASSET | CHAT
providerId (FK LLMProvider)
modelId: string
temperature: float, maxTokens: int
systemPrompt: string?
userPromptTemplate: string?
unique: (userId, processType)
```

### AIExecution
```
id, phase: string  -- RESEARCH | ANALYSIS | IDEATION | PRODUCTION | ASSET | CHAT
agentId?: (FK)
refType: string?, refId: string?  -- p.ej. "ANALYSIS_RUN"/"CONTENT"/"ASSET"
executionMode: string  -- API
modelUsed: string?
inputTokens: int?, outputTokens: int?, durationMs: int?
status: string  -- RUNNING | SUCCESS | ERROR
errorMessage: string?
createdAt
```
Índice: `(phase, createdAt desc)`, `(refType, refId)`.

---

## Módulos — Automatizaciones

### Automation
```
id, name: string
triggerType: string  -- MANUAL | SCHEDULED
cron: string?
targetType: string  -- SOURCE | ANALYSIS | PRODUCTION | ASSET
paramsJson: string?
isActive: bool
lastRunAt: datetime?
createdAt, updatedAt
```

### AutomationRun
```
id, automationId (FK)
status: string  -- RUNNING | SUCCESS | ERROR
logsText: string?
startedAt, finishedAt?
```

---

## Módulos — Chat

### ChatSession
```
id, userId (FK User), title: string, createdAt, updatedAt
```

### ChatMessage
```
id, sessionId (FK)
role: string  -- user | assistant | system
content: string
tokens: int?
contextRefsJson: string?  -- referencias a ideas/insights/contents etc.
createdAt
```

---

## Admin / Observabilidad

### AppSetting
```
id, key: string (unique)
value: string  -- JSON
category: string  -- general | ai | automations | storage
updatedAt
```

### Activity
```
id, userId?: (FK User)
entityType: string, entityId: string, action: string
metaJson: string?
createdAt
```
Índice: `(createdAt desc)`, `(entityType, entityId)`.

### ModelPrice
```
id, modelId: string (unique)  -- id tal cual se guarda en AIExecution.modelUsed
inputPer1M: float, outputPer1M: float  -- coste por millón de tokens
currency: string (default 'USD')
source: string  -- manual | auto
createdAt, updatedAt
```
Tarifa por modelo para calcular el coste del consumo; las marcadas `manual` no las pisa el refresco automático.

### BackupRun
```
id, kind: string  -- auto | manual | restore
status: string  -- ok | error
objectKey: string?  -- clave del blob cifrado en el bucket
sizeBytes: bigint?, durationMs: int?
error: string?
startedAt, finishedAt?
```
Registro de cada copia de seguridad o restauración. Índice: `(startedAt)`, `(kind, startedAt)`.

---

## Relationship Diagram (ASCII simplificado)

```
Source ──< Finding
                \
                 >── AnalysisRun ──< Insight
                                         \
                                          >── Idea ──< IdeaComment
                                          │     │
                                          │     └──< Content ──< ContentVersion
                                          │                 │
                                          │                 └──< Asset >── Channel
                                          └── (sin insight: idea manual)
BrandProfile (singleton)  →  consultado por Content al producir

User ──< LLMProvider ──< ProcessConfig
User ──< ChatSession ──< ChatMessage
User ──< IdeaComment

Agent ──(ref optional)── AnalysisRun, AIExecution
Automation ──< AutomationRun
Activity, AppSetting  —  transversales
```
