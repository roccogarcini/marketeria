-- Tarifa por modelo (unidades por millón de tokens) para el coste de consumo.
CREATE TABLE "ModelPrice" (
    "id" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "inputPer1M" DOUBLE PRECISION NOT NULL,
    "outputPer1M" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ModelPrice_modelId_key" ON "ModelPrice"("modelId");
