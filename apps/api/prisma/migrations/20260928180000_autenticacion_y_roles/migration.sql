-- AlterEnum
BEGIN;
CREATE TYPE "Rol_new" AS ENUM ('VENTAS', 'CAJA', 'FINANZAS', 'ADMIN', 'INTEGRACION');
ALTER TABLE "usuarios" ALTER COLUMN "rol" TYPE "Rol_new" USING (
  CASE "rol"::text
    WHEN 'CAJERO' THEN 'CAJA'
    WHEN 'VENDEDOR' THEN 'VENTAS'
    WHEN 'TESORERIA' THEN 'FINANZAS'
    ELSE "rol"::text
  END
)::"Rol_new";
ALTER TYPE "Rol" RENAME TO "Rol_old";
ALTER TYPE "Rol_new" RENAME TO "Rol";
DROP TYPE "public"."Rol_old";
COMMIT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "debeCambiarClave" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ultimoIngresoEn" TIMESTAMP(3),
ADD COLUMN     "usuario" VARCHAR(40),
ALTER COLUMN "correo" DROP NOT NULL;

-- Usuarios existentes: el nombre de usuario sale del correo (parte antes de @).
UPDATE "usuarios" SET "usuario" = lower(split_part("correo", '@', 1)) WHERE "usuario" IS NULL;
ALTER TABLE "usuarios" ALTER COLUMN "usuario" SET NOT NULL;

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "hashToken" CHAR(64) NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),
    "reemplazadaPor" UUID,
    "ip" VARCHAR(45),
    "agenteUsuario" VARCHAR(200),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sesiones_hashToken_key" ON "sesiones"("hashToken");

-- CreateIndex
CREATE INDEX "sesiones_usuarioId_revocadaEn_idx" ON "sesiones"("usuarioId", "revocadaEn");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_usuario_key" ON "usuarios"("usuario");

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
