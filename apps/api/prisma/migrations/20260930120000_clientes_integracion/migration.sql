-- CreateTable
CREATE TABLE "clientes_integracion" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "clientId" VARCHAR(60) NOT NULL,
    "hashSecreto" TEXT NOT NULL,
    "alcances" TEXT[],
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "ultimoUsoEn" TIMESTAMP(3),
    "creadoPorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_integracion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_integracion_clientId_key" ON "clientes_integracion"("clientId");

-- AddForeignKey
ALTER TABLE "clientes_integracion" ADD CONSTRAINT "clientes_integracion_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
