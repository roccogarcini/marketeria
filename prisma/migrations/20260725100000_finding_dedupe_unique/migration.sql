-- ============================================================================
-- Dedupe de hallazgos + clave estable de fuente externa
--
--  1. Finding: índice ÚNICO (sourceId, url) — cierra la ventana de carrera
--     entre el findFirst de comprobación y el create.
--  2. Source: columna externalKey (única) — permite que la investigación IA
--     lanzada desde la API v1 / MCP reutilice la misma fuente en vez de crear
--     una nueva en cada llamada (que es lo que dejaba el dedupe inservible y
--     hacía crecer Source sin límite).
--
-- ⚠️⚠️  AVISO — ESTA MIGRACIÓN BORRA FILAS  ⚠️⚠️
--
-- El índice único NO se puede crear si la tabla ya tiene hallazgos duplicados
-- por (sourceId, url). Si la instalación ya tiene datos, puede haberlos: dos
-- inserciones concurrentes sobre la misma fuente (una automatización y un
-- lanzamiento manual a la vez) dejan duplicados dentro de esa misma fuente.
--
-- Por eso el DELETE de abajo se ejecuta ANTES de crear el índice. Conserva el
-- hallazgo MÁS ANTIGUO de cada grupo (sourceId, url) y borra el resto.
--
-- ANTES DE APLICAR EN PRODUCCIÓN:
--   a) Copia de seguridad de la BD (el borrado es irreversible).
--   b) Cuenta lo que se va a borrar:
--        SELECT count(*) - count(DISTINCT ("sourceId", "url")) FROM "Finding"
--        WHERE "url" IS NOT NULL;
--   c) Ojo: AnalysisRun.findingIdsJson guarda ids de hallazgos como JSON y no
--      tiene FK. Si un análisis antiguo apuntaba a la copia borrada, ese id
--      queda colgando (el análisis ya guarda su resumen, no se rompe nada,
--      pero el detalle mostrará un hallazgo menos).
-- ============================================================================

-- 1) Limpieza previa: nos quedamos con el hallazgo más antiguo de cada
--    (sourceId, url). Los NULL en url no participan (nunca colisionan).
DELETE FROM "Finding" a
USING "Finding" b
WHERE a."url" IS NOT NULL
  AND b."url" IS NOT NULL
  AND a."sourceId" = b."sourceId"
  AND a."url" = b."url"
  AND (
    a."fetchedAt" > b."fetchedAt"
    OR (a."fetchedAt" = b."fetchedAt" AND a."id" > b."id")
  );

-- 2) Índice único que sostiene el dedupe.
CREATE UNIQUE INDEX "Finding_sourceId_url_key" ON "Finding"("sourceId", "url");

-- 3) Clave estable de las fuentes creadas desde la API externa / MCP.
ALTER TABLE "Source" ADD COLUMN "externalKey" TEXT;

CREATE UNIQUE INDEX "Source_externalKey_key" ON "Source"("externalKey");
