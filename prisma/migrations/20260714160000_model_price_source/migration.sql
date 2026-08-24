-- Origen de cada tarifa: "manual" (admin, no se pisa) | "auto" (catálogo OpenRouter).
ALTER TABLE "ModelPrice" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
