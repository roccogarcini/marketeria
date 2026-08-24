#!/bin/sh
set -e

# ─────────────────────────────────────────────────────────────────────────────
# Arranque del contenedor de la app:
#   1) aplica las migraciones de la base de datos
#   2) crea el primer ADMIN si la base está vacía
#   3) levanta el servidor
#
# Si el paso 1 falla, el contenedor se reinicia en bucle. Por eso aquí no se
# corta con un "migrate deploy failed" a secas: se lee el error de Prisma y se
# dice en castellano qué ha pasado y qué hay que tocar.
# ─────────────────────────────────────────────────────────────────────────────

# El CLI de Prisma viaja DENTRO de la imagen (ver el stage prisma-cli del
# Dockerfile), así que arrancar no depende de que el servidor tenga salida a
# internet ni de lo rápido que responda npm.
PRISMA_CLI="/opt/prisma-cli/node_modules/prisma/build/index.js"
MIGRATE_LOG="/tmp/migrate.log"

run_migrate() {
  if [ -f "$PRISMA_CLI" ]; then
    node "$PRISMA_CLI" migrate deploy
  else
    # Red de seguridad: si la imagen se hubiera construido sin el CLI, se
    # descarga de npm. Pin explícito a Prisma 6 — `npx prisma` sin
    # versión bajaría la 7.x, que rompe este schema ("url no longer supported
    # in schema files"). Cambiar a Prisma 7 implica migrar a prisma.config.ts.
    echo "[entrypoint] AVISO: el CLI de Prisma no está en la imagen; se descarga de npm (hace falta internet)."
    npx -y prisma@6 migrate deploy
  fi
}

echo "[entrypoint] aplicando migraciones..."
# Se borra el resultado anterior: en un reinicio del contenedor (no recreación)
# /tmp sobrevive, y un resultado viejo daría por buena una migración que no ha
# llegado a correr.
rm -f /tmp/migrate.rc "$MIGRATE_LOG"
{ run_migrate 2>&1 && echo 0 > /tmp/migrate.rc || echo 1 > /tmp/migrate.rc; } | tee "$MIGRATE_LOG"

if [ "$(cat /tmp/migrate.rc 2>/dev/null || echo 1)" != "0" ]; then
  echo ""
  echo "[entrypoint] ─────────────────────────────────────────────────────────"
  echo "[entrypoint] ERROR: no se han podido aplicar las migraciones."

  if grep -q "P1000" "$MIGRATE_LOG"; then
    echo "[entrypoint] Causa: la base de datos ha RECHAZADO LA CONTRASEÑA (Prisma P1000)."
    echo "[entrypoint]"
    echo "[entrypoint] Casi siempre es esto: el volumen de la base de datos ya existía de"
    echo "[entrypoint] un despliegue anterior y guarda la contraseña ANTIGUA, mientras que"
    echo "[entrypoint] DB_PASSWORD ahora es otra. Postgres solo hace caso a la contraseña"
    echo "[entrypoint] la primera vez que se crea el volumen."
    echo "[entrypoint]"
    echo "[entrypoint] Qué hacer, por orden:"
    echo "[entrypoint]  1) Abre los logs del servicio 'db' en EasyPanel. Tiene que salir la"
    echo "[entrypoint]     línea: '[db] Contraseña de spaider sincronizada con DB_PASSWORD.'"
    echo "[entrypoint]     Si en su lugar sale un AVISO, la sincronización no llegó a hacerse."
    echo "[entrypoint]  2) Reinicia el servicio (Restart) para que vuelva a intentarlo."
    echo "[entrypoint]  3) Si sigue igual y la base NO tiene datos que te importen: borra el"
    echo "[entrypoint]     volumen spaider_db y vuelve a desplegar. Se crea de cero con la"
    echo "[entrypoint]     contraseña actual."
    echo "[entrypoint]  4) Si la base SÍ tiene datos: no borres nada. Vuelve a poner en"
    echo "[entrypoint]     DB_PASSWORD la contraseña con la que se creó el volumen."
  elif grep -q "P1001" "$MIGRATE_LOG"; then
    echo "[entrypoint] Causa: no se llega al servidor de base de datos (Prisma P1001)."
    echo "[entrypoint] El servicio 'db' no está levantado, o todavía está arrancando."
    echo "[entrypoint] Mira sus logs en EasyPanel. Si acaba de desplegarse, dale un minuto:"
    echo "[entrypoint] este contenedor se reinicia solo y lo vuelve a intentar."
  elif grep -q "P1003" "$MIGRATE_LOG"; then
    echo "[entrypoint] Causa: la base de datos 'spaider' no existe (Prisma P1003)."
    echo "[entrypoint] Pasa si el volumen se creó con otro nombre de base. Lo más limpio:"
    echo "[entrypoint] borrar el volumen spaider_db y volver a desplegar."
  elif grep -q "P3009" "$MIGRATE_LOG"; then
    echo "[entrypoint] Causa: hay una migración anterior que quedó a medias (Prisma P3009)."
    echo "[entrypoint] Prisma no sigue hasta que se resuelva. En una instalación nueva, lo"
    echo "[entrypoint] rápido es borrar el volumen spaider_db y volver a desplegar."
  elif grep -qiE "ENOTFOUND|EAI_AGAIN|ETIMEDOUT|registry\.npmjs\.org" "$MIGRATE_LOG"; then
    echo "[entrypoint] Causa: el servidor no ha podido salir a internet para descargar Prisma."
    echo "[entrypoint] Esta imagen debería traer el CLI dentro; si estás viendo esto, se ha"
    echo "[entrypoint] construido sin él. Vuelve a construir la imagen (Deploy con caché"
    echo "[entrypoint] limpia) o revisa la salida a internet del servidor."
  else
    echo "[entrypoint] Causa: mira el error de Prisma justo aquí arriba."
    echo "[entrypoint] Lo más habitual en un despliegue nuevo es la contraseña de la base"
    echo "[entrypoint] (P1000) o que el servicio 'db' aún no esté en pie (P1001)."
  fi

  echo "[entrypoint] ─────────────────────────────────────────────────────────"
  exit 1
fi

# Crea el primer ADMIN si la BD está vacía y hay credenciales en el entorno.
echo "[entrypoint] bootstrap admin (si procede)..."
node scripts/bootstrap-admin.mjs || {
  echo "[entrypoint] ERROR: no se ha podido crear el usuario administrador."
  echo "[entrypoint] Revisa ADMIN_EMAIL y ADMIN_PASSWORD en las variables del servicio"
  echo "[entrypoint] (la contraseña necesita 8 caracteres como mínimo)."
  exit 1
}

echo "[entrypoint] arrancando el servidor..."
exec "$@"
