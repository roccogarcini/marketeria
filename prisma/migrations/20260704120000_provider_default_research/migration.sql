-- Proveedor LLM predeterminado para la Investigación IA (modo Automático).
-- Máximo uno activo por usuario; el enforcement vive en la capa de aplicación.
ALTER TABLE "LLMProvider" ADD COLUMN "isDefaultResearch" BOOLEAN NOT NULL DEFAULT false;
