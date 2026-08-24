# syntax=docker/dockerfile:1.7
# SpAIder — Dockerfile multi-stage (EasyPanel-ready).

############################################
# 1) deps — instala dependencias con cache estable
############################################
FROM node:20-alpine AS deps
WORKDIR /app

# Paquetes necesarios para bcryptjs y Prisma en Alpine
RUN apk add --no-cache libc6-compat openssl

# Puppeteer usa el Chromium del sistema en runner; no descargar Chrome propio
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts

############################################
# 2) builder — compila Next.js (output standalone)
############################################
FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma Client necesita generarse antes del build
RUN npx prisma generate

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
# Sello del build: /api/health lo expone para verificar qué build sirve prod.
RUN date -u +%Y-%m-%dT%H:%M:%SZ > /app/BUILD_TIME

############################################
# 2 bis) prisma-cli — el CLI de Prisma, dentro de la imagen
############################################
# El entrypoint aplica las migraciones al arrancar, y para eso necesita el CLI
# de Prisma. Se instala aquí, durante el build, y viaja dentro de la imagen: el
# arranque del contenedor no depende así de que el servidor pueda descargar nada
# de npm. La versión se lee del package-lock, para que sea exactamente la misma
# con la que se genera el cliente de Prisma en el paso anterior.
FROM node:20-alpine AS prisma-cli
WORKDIR /opt/prisma-cli
RUN apk add --no-cache libc6-compat openssl

COPY package-lock.json ./lock.json
RUN PRISMA_VERSION="$(node -p "require('./lock.json').packages['node_modules/prisma'].version")" \
 && echo "[build] Prisma CLI ${PRISMA_VERSION}" \
 && printf '{"name":"prisma-cli","private":true}\n' > package.json \
 && npm install --no-audit --no-fund "prisma@${PRISMA_VERSION}" \
 && rm -f lock.json \
 && node node_modules/prisma/build/index.js --version

############################################
# 3) runner — imagen final mínima
############################################
FROM node:20-alpine AS runner
WORKDIR /app
# chromium + fuentes: export PNG de carruseles vía Puppeteer (~+250 MB)
# postgresql17-client: pg_dump/pg_restore para las copias de seguridad. El
# servidor es postgres:16 y el cliente 17; pg_dump aborta si el cliente es MÁS
# ANTIGUO que el servidor, al revés no pasa nada.
RUN apk add --no-cache libc6-compat openssl tini \
    chromium nss freetype harfbuzz ca-certificates \
    ttf-freefont font-noto-emoji fontconfig \
    postgresql17-client

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# Chromium (crashpad) necesita escribir config/cache; el uid 1001 no tiene $HOME escribible
ENV XDG_CONFIG_HOME=/tmp/.chromium
ENV XDG_CACHE_HOME=/tmp/.chromium
# Prisma no comprueba versiones nuevas al arrancar (una llamada de red menos
# entre el arranque del contenedor y la app en pie).
ENV CHECKPOINT_DISABLE=1
ENV PRISMA_HIDE_UPDATE_MESSAGE=1

# Usuario no-root
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001 -G nodejs

# Output standalone de Next.js (node_modules mínimos incluidos)
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Prisma — schema + migraciones + engines
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

# Sello del build (lo lee /api/health)
COPY --from=builder --chown=nextjs:nodejs /app/BUILD_TIME ./BUILD_TIME

# Bootstrap del primer ADMIN (usa @prisma/client + bcryptjs del standalone)
COPY --from=builder --chown=nextjs:nodejs /app/scripts/bootstrap-admin.mjs ./scripts/bootstrap-admin.mjs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma/client ./node_modules/@prisma/client

# CLI de Prisma para el `migrate deploy` del entrypoint. Va fuera de /app para
# no mezclarse con los node_modules mínimos del standalone de Next.
COPY --from=prisma-cli --chown=nextjs:nodejs /opt/prisma-cli /opt/prisma-cli

# Directorio de uploads persistente (monta un volumen en prod)
RUN mkdir -p /app/storage/uploads && chown -R nextjs:nodejs /app/storage

# Entrypoint que aplica migraciones antes de arrancar
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# Healthcheck robusto: IPv4 explícito (localhost puede resolver a ::1, donde
# Node no escucha) y prueba en cascada $PORT, 80 (EasyPanel) y 3000 (local).
# start-period de 180 s: el primer arranque aplica todas las migraciones y crea
# el admin inicial, y en un servidor modesto eso pasa del minuto. Con un margen
# corto el despliegue se daba por fallido cuando en realidad solo iba lento.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD wget -q -O- "http://127.0.0.1:${PORT:-3000}/api/health" \
   || wget -q -O- http://127.0.0.1:80/api/health \
   || wget -q -O- http://127.0.0.1:3000/api/health \
   || exit 1

ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
