-- AlterTable
ALTER TABLE "pedidos_caja" ADD COLUMN     "idExterno" VARCHAR(80);

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_caja_idExterno_key" ON "pedidos_caja"("idExterno");
