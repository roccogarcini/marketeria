# Marketería

Sistema de marketing de contenidos con un pipeline editorial de cuatro fases:

**Panel → Investigación → Ideas → Creaciones**

La IA rastrea las fuentes que le indiques, saca hallazgos, propone ideas, tú
apruebas las que valen, y produce cada pieza adaptada al canal que toque.

> **Stack**: Next.js 15 · React 19 · TypeScript · Prisma 6 · PostgreSQL 16 ·
> NextAuth 5 · Tailwind + shadcn/ui · Apify · YouTube Data API.

> **Fuentes de entrada**: además de RSS, URL, Apify y la investigación con IA,
> hay dos que traen el material sin salir a buscarlo — **WordPress** (por la
> REST API del propio sitio: cuerpo completo, autor y fecha) y **WhatsApp**
> (los mensajes que llegan al número de WhatsApp Business, por webhook de Meta).

Se puede **instalar como aplicación** en el móvil y en el escritorio: el
navegador ofrece «Instalar» y queda con su icono, a pantalla completa.

---

## Ponerlo en marcha

Para desplegarlo en un servidor, la guía es
**[`DEPLOY_EASYPANEL.md`](DEPLOY_EASYPANEL.md)**: paso a paso, sin terminal
salvo para generar tres claves.

Lo que sigue es solo si quieres tocar el código en tu ordenador.

### Requisitos

- **Node.js 20 o superior** (`node -v`).
- **PostgreSQL 16**, en local o en Docker.
- *(Opcional)* un token de [Apify](https://console.apify.com/account/integrations)
  si quieres rastrear redes sociales.
- *(Opcional)* una clave de la [YouTube Data API](https://console.cloud.google.com/)
  para el motor de YouTube.

Las claves de los proveedores de IA **no** van en el fichero de entorno: se
pegan después desde el panel de administración y se guardan cifradas.

### Pasos

```bash
# 1) Dependencias
npm install

# 2) Tu fichero de entorno
cp .env.example .env
# Rellena al menos:
#   DATABASE_URL="postgresql://usuario:contraseña@localhost:5432/spaider"
#   NEXTAUTH_SECRET=$(openssl rand -base64 32)
#   ENCRYPTION_KEY=$(openssl rand -base64 32)
#   NEXTAUTH_URL=http://localhost:3000
#   ADMIN_EMAIL / ADMIN_PASSWORD (mínimo 8 caracteres)

# 3) Base de datos y datos iniciales
npx prisma migrate deploy
npm run db:seed

# 4) A trabajar
npm run dev
```

Entra en `http://localhost:3000` con el usuario y la contraseña que pusiste en
`ADMIN_EMAIL` y `ADMIN_PASSWORD`.

Comprobaciones: `npx tsc --noEmit` y `npm test`.

---

## Cómo está organizado

| Carpeta | Qué hay |
|---|---|
| `src/app/` | Pantallas y rutas de API (Next.js App Router). |
| `src/lib/ai/` | Enrutado de modelos, herramientas de los agentes, control de gasto. |
| `src/lib/research/` | Motores de investigación, descarga de fuentes y hallazgos. |
| `src/lib/apify/`, `src/lib/youtube/` | Conectores de redes sociales y de YouTube. |
| `src/lib/automations/` | Programación de investigaciones y producciones periódicas. |
| `src/lib/render/` | Exportación de carruseles a imagen. |
| `prisma/` | Esquema, migraciones y siembra inicial. |
| `design/` | Documentación de arquitectura, stack y modelo de datos. |
| `docs/` | Requisitos no funcionales: rendimiento, seguridad, retención. |
| `tests/` | Pruebas. |

---

## Lo primero que hay que configurar

1. **Marca**: quién eres, a quién hablas y con qué tono. Es lo que usa la IA
   para escribir; sin esto, todo sale genérico.
2. **Canales**: dónde publicas y con qué formato cada uno.
3. **Fuentes**: de dónde sale la información que rastrea.
4. **Claves de los proveedores**, en Admin → Proveedores.

Los cuatro se editan desde el panel. La instalación viene con ejemplos
neutros para que se entienda la estructura: cámbialos por los tuyos.

---

## Dos avisos que conviene leer

**Va con una sola instancia. No subas las réplicas.** La programación de las
automatizaciones y el control de intentos de login viven en la memoria del
proceso: con dos instancias, las tareas programadas se ejecutarían por
duplicado (y cada ejecución cuesta dinero en llamadas a la IA). Si se queda
corto, súbele CPU y memoria.

**Guarda tu `ENCRYPTION_KEY`.** Es la que cifra las claves de los proveedores
guardadas en la base de datos. Si la pierdes, hay que volver a introducirlas
todas.

---

## Coste

Cada instalación usa sus propias claves y paga su consumo directamente a cada
proveedor. En Admin → Consumo tienes el gasto por ejecución y un tope mensual
que, al alcanzarse, corta las llamadas en vez de seguir gastando.

## Licencia

Puedes usar esta aplicación en tu negocio y montarla para clientes tuyos, sin
límite. Lo que no puedes hacer es compartir, publicar ni vender el código ni el
paquete descargable a nadie. Las condiciones completas están en
[LICENCIA.md](LICENCIA.md).
