-- ============================================================================
-- Índice por createdAt en AIExecution — soporte del corte por presupuesto
--
-- El corte por tope mensual (src/lib/ai/budget.ts) agrega el gasto del mes
-- natural con un groupBy sobre AIExecution filtrando SOLO por createdAt, y lo
-- hace ANTES de cada llamada al LLM. Los índices que ya había empiezan por
-- otra columna (phase, refType, executionMode), así que ninguno sirve para ese
-- filtro: sin este índice, cada llamada haría un seq scan de la tabla entera.
--
-- Es un índice normal (no único) y no modifica ni borra datos. En una tabla
-- grande, CREATE INDEX bloquea escrituras mientras se construye; si eso
-- molesta en producción, la variante concurrente equivalente es:
--   CREATE INDEX CONCURRENTLY "AIExecution_createdAt_idx" ON "AIExecution"("createdAt");
-- (CONCURRENTLY no puede ir dentro de la transacción de `prisma migrate`, por
-- eso aquí va la forma normal.)
-- ============================================================================

CREATE INDEX "AIExecution_createdAt_idx" ON "AIExecution"("createdAt");
