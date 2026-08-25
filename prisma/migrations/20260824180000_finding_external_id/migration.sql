-- Identificador de la pieza en su sistema de origen (wamid de WhatsApp, id de
-- mensaje de Discord…). Deduplica las fuentes de ENTRADA: llegan por webhook,
-- Meta reenvía "al menos una vez" y no traen URL, así que el índice único de
-- (sourceId, url) no las cubre.
ALTER TABLE "Finding" ADD COLUMN "externalId" TEXT;

-- NULL no colisiona en Postgres: los hallazgos de siempre (sin externalId)
-- siguen sin verse afectados por este índice.
CREATE UNIQUE INDEX "Finding_sourceId_externalId_key" ON "Finding"("sourceId", "externalId");
