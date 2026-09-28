-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('CAJERO', 'VENDEDOR', 'TESORERIA', 'ADMIN', 'INTEGRACION');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('DNI', 'RUC', 'CE');

-- CreateEnum
CREATE TYPE "TipoCliente" AS ENUM ('MAYORISTA', 'MINORISTA', 'CONSUMIDOR_FINAL');

-- CreateEnum
CREATE TYPE "Moneda" AS ENUM ('PEN', 'USD');

-- CreateEnum
CREATE TYPE "TipoCuentaBancaria" AS ENUM ('CORRIENTE', 'AHORROS');

-- CreateEnum
CREATE TYPE "TipoComprobante" AS ENUM ('FACTURA', 'BOLETA');

-- CreateEnum
CREATE TYPE "EstadoComprobante" AS ENUM ('PENDIENTE', 'PARCIAL', 'PAGADO');

-- CreateEnum
CREATE TYPE "EstadoPedido" AS ENUM ('ABIERTO', 'PAGADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoMovimiento" AS ENUM ('ABONO', 'CARGO');

-- CreateEnum
CREATE TYPE "Canal" AS ENUM ('TRANSFERENCIA', 'INTERBANCARIA', 'YAPE', 'PLIN', 'DEPOSITO_AGENCIA');

-- CreateEnum
CREATE TYPE "EstadoConciliacion" AS ENUM ('CONCILIADO', 'PROBABLE', 'SIN_IDENTIFICAR', 'DESCARTADO');

-- CreateEnum
CREATE TYPE "ResultadoValidacion" AS ENUM ('COINCIDE', 'NO_COINCIDE', 'NO_DISPONIBLE');

-- CreateEnum
CREATE TYPE "TipoAlerta" AS ENUM ('PAGO_CONCILIADO', 'SIN_IDENTIFICAR_ANTIGUO', 'MONTO_INUSUAL', 'PAGO_DUPLICADO', 'PROVEEDOR_NO_COINCIDE');

-- CreateEnum
CREATE TYPE "Severidad" AS ENUM ('INFO', 'ADVERTENCIA', 'CRITICA');

-- CreateEnum
CREATE TYPE "CanalNotificacion" AS ENUM ('PANTALLA', 'WHATSAPP', 'CORREO');

-- CreateEnum
CREATE TYPE "TipoDestinatario" AS ENUM ('VENDEDOR', 'CLIENTE', 'CAJA');

-- CreateEnum
CREATE TYPE "EstadoNotificacion" AS ENUM ('PENDIENTE', 'ENVIADA', 'FALLIDA');

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "correo" VARCHAR(160) NOT NULL,
    "hashClave" TEXT NOT NULL,
    "rol" "Rol" NOT NULL,
    "telefono" VARCHAR(20),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clientes" (
    "id" UUID NOT NULL,
    "tipoDoc" "TipoDocumento" NOT NULL,
    "numeroDoc" VARCHAR(15) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "tipo" "TipoCliente" NOT NULL,
    "telefono" VARCHAR(20),
    "correo" VARCHAR(160),
    "vendedorId" UUID,
    "consentimientoNotificaciones" BOOLEAN NOT NULL DEFAULT false,
    "consentimientoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alias_cliente" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "alias" VARCHAR(200) NOT NULL,
    "aliasNormalizado" VARCHAR(200) NOT NULL,
    "registradoPorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alias_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_origen_cliente" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "banco" VARCHAR(40),
    "cuenta" VARCHAR(30) NOT NULL,
    "vecesVista" INTEGER NOT NULL DEFAULT 1,
    "ultimaVez" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cuentas_origen_cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comprobantes" (
    "id" UUID NOT NULL,
    "tipo" "TipoComprobante" NOT NULL,
    "serie" VARCHAR(4) NOT NULL,
    "numero" INTEGER NOT NULL,
    "clienteId" UUID NOT NULL,
    "fechaEmision" DATE NOT NULL,
    "fechaVencimiento" DATE NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "saldoPendiente" DECIMAL(14,2) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "estado" "EstadoComprobante" NOT NULL DEFAULT 'PENDIENTE',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comprobantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_caja" (
    "id" UUID NOT NULL,
    "tienda" VARCHAR(60) NOT NULL,
    "caja" VARCHAR(20) NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" "Moneda" NOT NULL DEFAULT 'PEN',
    "clienteId" UUID,
    "estado" "EstadoPedido" NOT NULL DEFAULT 'ABIERTO',
    "creadoPorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),

    CONSTRAINT "pedidos_caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cuentas_bancarias" (
    "id" VARCHAR(40) NOT NULL,
    "banco" VARCHAR(40) NOT NULL,
    "numero" VARCHAR(30) NOT NULL,
    "cci" CHAR(20) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "tipo" "TipoCuentaBancaria" NOT NULL,
    "descripcion" VARCHAR(80),
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "cuentas_bancarias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimientos" (
    "id" UUID NOT NULL,
    "proveedor" VARCHAR(20) NOT NULL,
    "idBanco" VARCHAR(80) NOT NULL,
    "cuentaId" VARCHAR(40) NOT NULL,
    "fechaHora" TIMESTAMP(3) NOT NULL,
    "tipo" "TipoMovimiento" NOT NULL,
    "monto" DECIMAL(14,2) NOT NULL,
    "moneda" "Moneda" NOT NULL,
    "canal" "Canal" NOT NULL,
    "numeroOperacion" VARCHAR(40) NOT NULL,
    "ordenanteNombre" VARCHAR(200),
    "ordenanteTipoDoc" "TipoDocumento",
    "ordenanteNumeroDoc" VARCHAR(15),
    "ordenanteBanco" VARCHAR(40),
    "ordenanteCuenta" VARCHAR(30),
    "referencia" VARCHAR(200),
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conciliaciones" (
    "id" UUID NOT NULL,
    "movimientoId" UUID NOT NULL,
    "comprobanteId" UUID,
    "pedidoId" UUID,
    "puntaje" DECIMAL(4,3) NOT NULL,
    "estado" "EstadoConciliacion" NOT NULL,
    "motivos" JSONB NOT NULL,
    "candidatos" JSONB,
    "montoAplicado" DECIMAL(14,2),
    "confirmadoPorId" UUID,
    "confirmadoEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conciliaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proveedores" (
    "id" UUID NOT NULL,
    "ruc" CHAR(11) NOT NULL,
    "razonSocial" VARCHAR(200) NOT NULL,
    "cci" CHAR(20) NOT NULL,
    "titularEsperado" VARCHAR(200) NOT NULL,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proveedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "validaciones_proveedor" (
    "id" UUID NOT NULL,
    "proveedorId" UUID NOT NULL,
    "cci" CHAR(20) NOT NULL,
    "titularDevuelto" VARCHAR(200),
    "resultado" "ResultadoValidacion" NOT NULL,
    "similitud" DECIMAL(4,3),
    "usuarioId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "validaciones_proveedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alertas" (
    "id" UUID NOT NULL,
    "tipo" "TipoAlerta" NOT NULL,
    "severidad" "Severidad" NOT NULL,
    "mensaje" VARCHAR(300) NOT NULL,
    "movimientoId" UUID,
    "proveedorId" UUID,
    "atendida" BOOLEAN NOT NULL DEFAULT false,
    "atendidaPorId" UUID,
    "atendidaEn" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificaciones" (
    "id" UUID NOT NULL,
    "canal" "CanalNotificacion" NOT NULL,
    "tipoDestinatario" "TipoDestinatario" NOT NULL,
    "destinatario" VARCHAR(160) NOT NULL,
    "plantilla" VARCHAR(60) NOT NULL,
    "datos" JSONB NOT NULL,
    "estado" "EstadoNotificacion" NOT NULL DEFAULT 'PENDIENTE',
    "simulada" BOOLEAN NOT NULL DEFAULT false,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "proximoIntento" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadaEn" TIMESTAMP(3),
    "conciliacionId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suscripciones_webhook" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "eventos" TEXT[],
    "secreto" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suscripciones_webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" BIGSERIAL NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" UUID,
    "accion" VARCHAR(60) NOT NULL,
    "entidad" VARCHAR(40) NOT NULL,
    "entidadId" VARCHAR(80),
    "datos" JSONB NOT NULL,
    "hashAnterior" CHAR(64),
    "hash" CHAR(64) NOT NULL,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE INDEX "clientes_nombre_idx" ON "clientes"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_tipoDoc_numeroDoc_key" ON "clientes"("tipoDoc", "numeroDoc");

-- CreateIndex
CREATE INDEX "alias_cliente_aliasNormalizado_idx" ON "alias_cliente"("aliasNormalizado");

-- CreateIndex
CREATE UNIQUE INDEX "alias_cliente_clienteId_aliasNormalizado_key" ON "alias_cliente"("clienteId", "aliasNormalizado");

-- CreateIndex
CREATE INDEX "cuentas_origen_cliente_cuenta_idx" ON "cuentas_origen_cliente"("cuenta");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_origen_cliente_clienteId_cuenta_key" ON "cuentas_origen_cliente"("clienteId", "cuenta");

-- CreateIndex
CREATE INDEX "comprobantes_clienteId_estado_fechaEmision_idx" ON "comprobantes"("clienteId", "estado", "fechaEmision");

-- CreateIndex
CREATE INDEX "comprobantes_estado_fechaVencimiento_idx" ON "comprobantes"("estado", "fechaVencimiento");

-- CreateIndex
CREATE UNIQUE INDEX "comprobantes_serie_numero_key" ON "comprobantes"("serie", "numero");

-- CreateIndex
CREATE INDEX "pedidos_caja_estado_creadoEn_idx" ON "pedidos_caja"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "pedidos_caja_monto_idx" ON "pedidos_caja"("monto");

-- CreateIndex
CREATE UNIQUE INDEX "cuentas_bancarias_cci_key" ON "cuentas_bancarias"("cci");

-- CreateIndex
CREATE INDEX "movimientos_fechaHora_idx" ON "movimientos"("fechaHora");

-- CreateIndex
CREATE INDEX "movimientos_monto_idx" ON "movimientos"("monto");

-- CreateIndex
CREATE INDEX "movimientos_cuentaId_fechaHora_idx" ON "movimientos"("cuentaId", "fechaHora");

-- CreateIndex
CREATE UNIQUE INDEX "movimientos_proveedor_idBanco_key" ON "movimientos"("proveedor", "idBanco");

-- CreateIndex
CREATE INDEX "conciliaciones_estado_creadoEn_idx" ON "conciliaciones"("estado", "creadoEn");

-- CreateIndex
CREATE INDEX "conciliaciones_movimientoId_idx" ON "conciliaciones"("movimientoId");

-- CreateIndex
CREATE UNIQUE INDEX "proveedores_ruc_key" ON "proveedores"("ruc");

-- CreateIndex
CREATE INDEX "validaciones_proveedor_proveedorId_creadoEn_idx" ON "validaciones_proveedor"("proveedorId", "creadoEn");

-- CreateIndex
CREATE INDEX "alertas_atendida_creadoEn_idx" ON "alertas"("atendida", "creadoEn");

-- CreateIndex
CREATE INDEX "notificaciones_estado_proximoIntento_idx" ON "notificaciones"("estado", "proximoIntento");

-- CreateIndex
CREATE UNIQUE INDEX "auditoria_hash_key" ON "auditoria"("hash");

-- CreateIndex
CREATE INDEX "auditoria_entidad_entidadId_idx" ON "auditoria"("entidad", "entidadId");

-- CreateIndex
CREATE INDEX "auditoria_fecha_idx" ON "auditoria"("fecha");

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alias_cliente" ADD CONSTRAINT "alias_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alias_cliente" ADD CONSTRAINT "alias_cliente_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cuentas_origen_cliente" ADD CONSTRAINT "cuentas_origen_cliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comprobantes" ADD CONSTRAINT "comprobantes_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_caja" ADD CONSTRAINT "pedidos_caja_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_caja" ADD CONSTRAINT "pedidos_caja_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_cuentaId_fkey" FOREIGN KEY ("cuentaId") REFERENCES "cuentas_bancarias"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "movimientos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_comprobanteId_fkey" FOREIGN KEY ("comprobanteId") REFERENCES "comprobantes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_pedidoId_fkey" FOREIGN KEY ("pedidoId") REFERENCES "pedidos_caja"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conciliaciones" ADD CONSTRAINT "conciliaciones_confirmadoPorId_fkey" FOREIGN KEY ("confirmadoPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validaciones_proveedor" ADD CONSTRAINT "validaciones_proveedor_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "validaciones_proveedor" ADD CONSTRAINT "validaciones_proveedor_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_movimientoId_fkey" FOREIGN KEY ("movimientoId") REFERENCES "movimientos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_proveedorId_fkey" FOREIGN KEY ("proveedorId") REFERENCES "proveedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_atendidaPorId_fkey" FOREIGN KEY ("atendidaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_conciliacionId_fkey" FOREIGN KEY ("conciliacionId") REFERENCES "conciliaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Auditoría inalterable: la base de datos rechaza UPDATE y DELETE,
-- aunque la aplicación tenga un error o alguien obtenga sus credenciales.
CREATE OR REPLACE FUNCTION auditoria_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'La auditoría es de solo inserción: % no permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auditoria_sin_update_ni_delete
  BEFORE UPDATE OR DELETE ON "auditoria"
  FOR EACH ROW EXECUTE FUNCTION auditoria_solo_insercion();
