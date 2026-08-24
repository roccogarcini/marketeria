-- Enriquecimiento de hallazgos: texto completo de la pieza original.
ALTER TABLE "Finding" ADD COLUMN "fullContent" TEXT;

-- Agente asignado por canal: su systemPrompt manda al generar la creación.
ALTER TABLE "Channel" ADD COLUMN "agentId" TEXT;
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
