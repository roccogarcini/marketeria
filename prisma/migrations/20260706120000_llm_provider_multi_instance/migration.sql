-- LLMProvider: permitir varias instancias del mismo tipo (p. ej. dos z.ai:
-- coding y estándar). Se cambia la unicidad de (userId, providerType) a
-- (userId, displayName): los proveedores se distinguen por nombre.
DROP INDEX "LLMProvider_userId_providerType_key";
CREATE UNIQUE INDEX "LLMProvider_userId_displayName_key" ON "LLMProvider"("userId", "displayName");
