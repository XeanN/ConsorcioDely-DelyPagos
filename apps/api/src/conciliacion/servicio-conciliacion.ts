import type { BaseDatos } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { BusEventos } from '../eventos/bus.js';
import type { UsuarioSesion } from '../auth/tipos.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';
import { INCLUIR_VISTA, aVista } from '../movimientos/vista.js';
import { formatearSoles } from './formato.js';
import {
  conciliar,
  type Candidato,
  type ClienteCandidato,
  type ConfigMotor,
  type Evaluacion,
  type ResultadoConciliacion,
} from './motor.js';
import { normalizarNombre } from './normalizar.js';

type Transaccion = Prisma.TransactionClient;

export interface Destino {
  tipo: 'PEDIDO' | 'COMPROBANTE';
  id: string;
}

export class ErrorConciliacion extends Error {
  constructor(
    readonly estado: 400 | 404 | 409,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

interface Registro {
  error(datos: object, mensaje: string): void;
}

const INCLUIR_CLIENTE = {
  alias: { select: { alias: true } },
  cuentasOrigen: { select: { cuenta: true } },
} as const;

type ClienteConRelaciones = Prisma.ClienteGetPayload<{ include: typeof INCLUIR_CLIENTE }>;

function aClienteCandidato(c: ClienteConRelaciones): ClienteCandidato {
  return {
    id: c.id,
    nombre: c.nombre,
    tipoDoc: c.tipoDoc,
    numeroDoc: c.numeroDoc,
    alias: c.alias.map((a) => a.alias),
    cuentasOrigen: c.cuentasOrigen.map((x) => x.cuenta.replace(/\D/g, '')),
  };
}

const redondear2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Aplica el motor de conciliación sobre la base de datos: guarda la decisión,
 * marca pedidos y comprobantes como pagados, aprende alias y cuentas, y audita.
 */
export class ServicioConciliacion {
  constructor(
    private readonly db: BaseDatos,
    private readonly bus: BusEventos,
    private readonly cfg: ConfigMotor,
    private readonly registro: Registro = console,
  ) {}

  /** Concilia automáticamente un movimiento recién llegado (idempotente). */
  async conciliarMovimiento(movimientoId: string): Promise<ResultadoConciliacion | null> {
    const m = await this.db.movimiento.findUnique({
      where: { id: movimientoId },
      include: { conciliaciones: { select: { id: true }, take: 1 } },
    });
    if (!m || m.tipo !== 'ABONO' || m.conciliaciones.length > 0) return null;

    const entrada = {
      monto: Number(m.monto),
      moneda: m.moneda,
      fechaHora: m.fechaHora,
      ordenanteNombre: m.ordenanteNombre,
      ordenanteNumeroDoc: m.ordenanteNumeroDoc,
      ordenanteCuenta: m.ordenanteCuenta,
      referencia: m.referencia,
    };
    let resultado = conciliar(entrada, await this.cargarCandidatos(entrada), this.cfg);

    await this.db.$transaction(async (tx) => {
      if (resultado.estado === 'CONCILIADO' && resultado.destino) {
        const aplicado = await this.aplicarDestino(tx, resultado.destino, resultado.destino.montoAplicado);
        if (!aplicado) {
          // Otro pago lo cubrió un instante antes: se deja para revisión humana.
          resultado = {
            ...resultado,
            estado: 'PROBABLE',
            motivos: [...resultado.motivos, 'el destino ya fue pagado por otro abono: revisar'],
          };
        }
      }
      const destino = resultado.destino;
      await tx.conciliacion.create({
        data: {
          movimientoId,
          estado: resultado.estado,
          puntaje: resultado.puntaje.toFixed(3),
          motivos: resultado.motivos,
          candidatos: resultado.candidatos as unknown as Prisma.InputJsonValue,
          comprobanteId: destino?.tipo === 'COMPROBANTE' ? destino.id : null,
          pedidoId: destino?.tipo === 'PEDIDO' ? destino.id : null,
          montoAplicado: resultado.estado === 'CONCILIADO' && destino ? destino.montoAplicado.toFixed(2) : null,
        },
      });
      if (resultado.estado === 'CONCILIADO' && destino?.clienteId && m.ordenanteCuenta) {
        await this.aprenderCuenta(tx, destino.clienteId, m.ordenanteCuenta, m.ordenanteBanco);
      }
      if (resultado.estado === 'CONCILIADO' && destino) {
        await registrarAuditoria(tx, {
          accion: 'CONCILIACION_AUTOMATICA',
          entidad: 'movimiento',
          entidadId: movimientoId,
          datos: {
            idBanco: m.idBanco,
            monto: Number(m.monto),
            destino: { tipo: destino.tipo, id: destino.id, descripcion: destino.descripcion },
            puntaje: resultado.puntaje,
            motivos: resultado.motivos,
          },
        });
      }
    });

    await this.publicar(movimientoId);
    return resultado;
  }

  /** Una persona confirma el destino de un pago PROBABLE o SIN_IDENTIFICAR (regla 6: se audita). */
  async confirmar(conciliacionId: string, destino: Destino, usuario: UsuarioSesion): Promise<void> {
    const conciliacion = await this.db.conciliacion.findUnique({
      where: { id: conciliacionId },
      include: { movimiento: true },
    });
    if (!conciliacion) throw new ErrorConciliacion(404, 'Conciliación no encontrada.');
    if (conciliacion.estado !== 'PROBABLE' && conciliacion.estado !== 'SIN_IDENTIFICAR') {
      throw new ErrorConciliacion(409, 'Este pago ya fue resuelto.');
    }
    const m = conciliacion.movimiento;
    const monto = Number(m.monto);
    const info = await this.describirDestino(destino, m.moneda);
    const montoAplicado = redondear2(Math.min(monto, info.pendiente));

    const aprendido: { alias?: string; cuenta?: string } = {};
    await this.db.$transaction(async (tx) => {
      // Solo una confirmación gana si dos personas confirman a la vez.
      const tomada = await tx.conciliacion.updateMany({
        where: { id: conciliacionId, estado: { in: ['PROBABLE', 'SIN_IDENTIFICAR'] } },
        data: {
          estado: 'CONCILIADO',
          comprobanteId: destino.tipo === 'COMPROBANTE' ? destino.id : null,
          pedidoId: destino.tipo === 'PEDIDO' ? destino.id : null,
          montoAplicado: montoAplicado.toFixed(2),
          confirmadoPorId: usuario.id,
          confirmadoEn: new Date(),
        },
      });
      if (tomada.count === 0) throw new ErrorConciliacion(409, 'Este pago ya fue resuelto.');
      if (!(await this.aplicarDestino(tx, destino, montoAplicado))) {
        throw new ErrorConciliacion(409, 'El pedido o comprobante ya no está pendiente.');
      }

      if (info.clienteId) {
        // Aprender: el nombre con el que pagó y la cuenta de origen quedan asociados al cliente.
        if (m.ordenanteNombre) {
          const normalizado = normalizarNombre(m.ordenanteNombre);
          if (normalizado && normalizado !== normalizarNombre(info.clienteNombre ?? '')) {
            const creado = await tx.aliasCliente.upsert({
              where: { clienteId_aliasNormalizado: { clienteId: info.clienteId, aliasNormalizado: normalizado } },
              create: {
                clienteId: info.clienteId,
                alias: m.ordenanteNombre,
                aliasNormalizado: normalizado,
                registradoPorId: usuario.id,
              },
              update: {},
            });
            aprendido.alias = creado.alias;
          }
        }
        if (m.ordenanteCuenta) {
          await this.aprenderCuenta(tx, info.clienteId, m.ordenanteCuenta, m.ordenanteBanco);
          aprendido.cuenta = m.ordenanteCuenta.slice(-4);
        }
      }

      await registrarAuditoria(tx, {
        usuarioId: usuario.id,
        accion: 'CONCILIACION_CONFIRMADA',
        entidad: 'movimiento',
        entidadId: m.id,
        datos: {
          conciliacionId,
          estadoAnterior: conciliacion.estado,
          idBanco: m.idBanco,
          monto,
          destino: { tipo: destino.tipo, id: destino.id, descripcion: info.descripcion },
          montoAplicado,
          aprendido,
        },
      });
    });

    await this.publicar(m.id);
  }

  /** Marca un pago como no correspondiente a ventas (devolución, préstamo, error del banco…). */
  async descartar(conciliacionId: string, motivo: string, usuario: UsuarioSesion): Promise<void> {
    const conciliacion = await this.db.conciliacion.findUnique({ where: { id: conciliacionId } });
    if (!conciliacion) throw new ErrorConciliacion(404, 'Conciliación no encontrada.');
    await this.db.$transaction(async (tx) => {
      const tomada = await tx.conciliacion.updateMany({
        where: { id: conciliacionId, estado: { in: ['PROBABLE', 'SIN_IDENTIFICAR'] } },
        data: {
          estado: 'DESCARTADO',
          comprobanteId: null,
          pedidoId: null,
          confirmadoPorId: usuario.id,
          confirmadoEn: new Date(),
        },
      });
      if (tomada.count === 0) throw new ErrorConciliacion(409, 'Este pago ya fue resuelto.');
      await registrarAuditoria(tx, {
        usuarioId: usuario.id,
        accion: 'CONCILIACION_DESCARTADA',
        entidad: 'movimiento',
        entidadId: conciliacion.movimientoId,
        datos: { conciliacionId, motivo },
      });
    });
    await this.publicar(conciliacion.movimientoId);
  }

  /**
   * Deshace una conciliación equivocada (o un descarte). Devuelve el pedido a "esperando pago"
   * o el saldo al comprobante, olvida lo aprendido de ese pago y lo regresa a la bandeja.
   */
  async revertir(conciliacionId: string, motivo: string, usuario: UsuarioSesion): Promise<void> {
    const c = await this.db.conciliacion.findUnique({
      where: { id: conciliacionId },
      include: { movimiento: true },
    });
    if (!c) throw new ErrorConciliacion(404, 'Conciliación no encontrada.');
    if (c.estado !== 'CONCILIADO' && c.estado !== 'DESCARTADO') {
      throw new ErrorConciliacion(409, 'Solo se puede deshacer un pago conciliado o descartado.');
    }
    const m = c.movimiento;
    const monto = c.montoAplicado === null ? 0 : Number(c.montoAplicado);
    const olvidado: { alias?: string; cuenta?: string } = {};

    await this.db.$transaction(async (tx) => {
      const tomada = await tx.conciliacion.updateMany({
        where: { id: conciliacionId, estado: c.estado },
        data: {
          estado: 'SIN_IDENTIFICAR',
          comprobanteId: null,
          pedidoId: null,
          montoAplicado: null,
          confirmadoPorId: null,
          confirmadoEn: null,
          motivos: [...((c.motivos as string[]) ?? []), `revertido por ${usuario.nombre}: ${motivo}`],
        },
      });
      if (tomada.count === 0) throw new ErrorConciliacion(409, 'Este pago cambió mientras tanto; recargue.');

      let clienteId: string | null = null;
      if (c.estado === 'CONCILIADO' && c.pedidoId) {
        const pedido = await tx.pedidoCaja.findUnique({ where: { id: c.pedidoId } });
        clienteId = pedido?.clienteId ?? null;
        await tx.pedidoCaja.updateMany({
          where: { id: c.pedidoId, estado: 'PAGADO' },
          data: { estado: 'ABIERTO', cerradoEn: null },
        });
      }
      if (c.estado === 'CONCILIADO' && c.comprobanteId) {
        const comprobante = await tx.comprobante.findUniqueOrThrow({ where: { id: c.comprobanteId } });
        clienteId = comprobante.clienteId;
        const total = Number(comprobante.total);
        const saldo = Math.min(total, Math.round((Number(comprobante.saldoPendiente) + monto) * 100) / 100);
        const r = await tx.comprobante.updateMany({
          where: { id: comprobante.id, saldoPendiente: comprobante.saldoPendiente },
          data: {
            saldoPendiente: saldo.toFixed(2),
            estado: saldo >= total - 0.005 ? 'PENDIENTE' : 'PARCIAL',
          },
        });
        if (r.count === 0) throw new ErrorConciliacion(409, 'El comprobante cambió mientras tanto; recargue.');
      }

      // Olvidar lo aprendido de este pago: el alias y la cuenta vistos en la confirmación equivocada.
      if (clienteId && c.confirmadoEn) {
        if (m.ordenanteNombre) {
          const aliasNormalizado = normalizarNombre(m.ordenanteNombre);
          const borrados = await tx.aliasCliente.deleteMany({
            where: { clienteId, aliasNormalizado, creadoEn: { gte: new Date(c.confirmadoEn.getTime() - 5_000) } },
          });
          if (borrados.count > 0) olvidado.alias = m.ordenanteNombre;
        }
      }
      if (clienteId && m.ordenanteCuenta) {
        const cuenta = await tx.cuentaOrigenCliente.findUnique({
          where: { clienteId_cuenta: { clienteId, cuenta: m.ordenanteCuenta } },
        });
        if (cuenta) {
          if (cuenta.vecesVista <= 1) await tx.cuentaOrigenCliente.delete({ where: { id: cuenta.id } });
          else await tx.cuentaOrigenCliente.update({ where: { id: cuenta.id }, data: { vecesVista: { decrement: 1 } } });
          olvidado.cuenta = m.ordenanteCuenta.slice(-4);
        }
      }

      await registrarAuditoria(tx, {
        usuarioId: usuario.id,
        accion: 'CONCILIACION_REVERTIDA',
        entidad: 'movimiento',
        entidadId: m.id,
        datos: {
          conciliacionId,
          estadoAnterior: c.estado,
          idBanco: m.idBanco,
          monto: Number(m.monto),
          destinoAnterior: c.pedidoId ? { tipo: 'PEDIDO', id: c.pedidoId } : c.comprobanteId ? { tipo: 'COMPROBANTE', id: c.comprobanteId } : null,
          montoDevuelto: monto,
          motivo,
          olvidado,
        },
      });
    });

    await this.publicar(m.id);
  }

  /** Concilia los movimientos de un rango que todavía no tienen decisión. */
  async procesarPendientes(desde: Date, hasta: Date): Promise<number> {
    const pendientes = await this.db.movimiento.findMany({
      where: { tipo: 'ABONO', fechaHora: { gte: desde, lt: hasta }, conciliaciones: { none: {} } },
      select: { id: true },
      orderBy: { fechaHora: 'asc' },
    });
    for (const { id } of pendientes) {
      try {
        await this.conciliarMovimiento(id);
      } catch (error) {
        this.registro.error({ err: error, movimientoId: id }, 'No se pudo conciliar el movimiento');
      }
    }
    return pendientes.length;
  }

  // ─── Internos ────────────────────────────────────────────

  private async cargarCandidatos(m: { monto: number; moneda: 'PEN' | 'USD'; fechaHora: Date }): Promise<Candidato[]> {
    const ventanaMs = this.cfg.ventanaPedidoMin * 60_000;
    const [pedidos, comprobantes] = await Promise.all([
      this.db.pedidoCaja.findMany({
        where: {
          estado: 'ABIERTO',
          moneda: m.moneda,
          creadoEn: { gte: new Date(m.fechaHora.getTime() - ventanaMs), lte: new Date(m.fechaHora.getTime() + 120_000) },
        },
        include: { cliente: { include: INCLUIR_CLIENTE } },
      }),
      this.db.comprobante.findMany({
        where: {
          estado: { in: ['PENDIENTE', 'PARCIAL'] },
          moneda: m.moneda,
          saldoPendiente: { gte: Math.max(0.01, m.monto - this.cfg.toleranciaMonto).toFixed(2) },
        },
        include: { cliente: { include: INCLUIR_CLIENTE } },
      }),
    ]);
    return [
      ...pedidos.map(
        (p): Candidato => ({
          tipo: 'PEDIDO',
          id: p.id,
          monto: Number(p.monto),
          moneda: p.moneda,
          creadoEn: p.creadoEn,
          tienda: p.tienda,
          caja: p.caja,
          cliente: p.cliente ? aClienteCandidato(p.cliente) : null,
        }),
      ),
      ...comprobantes.map(
        (c): Candidato => ({
          tipo: 'COMPROBANTE',
          id: c.id,
          serie: c.serie,
          numero: c.numero,
          saldoPendiente: Number(c.saldoPendiente),
          moneda: c.moneda,
          fechaEmision: c.fechaEmision,
          cliente: aClienteCandidato(c.cliente),
        }),
      ),
    ];
  }

  /** Marca el pedido como pagado o descuenta el saldo del comprobante. Falso si ya no estaba pendiente. */
  private async aplicarDestino(tx: Transaccion, destino: Pick<Evaluacion, 'tipo' | 'id'>, monto: number): Promise<boolean> {
    if (destino.tipo === 'PEDIDO') {
      const r = await tx.pedidoCaja.updateMany({
        where: { id: destino.id, estado: 'ABIERTO' },
        data: { estado: 'PAGADO', cerradoEn: new Date() },
      });
      return r.count === 1;
    }
    const comprobante = await tx.comprobante.findUnique({ where: { id: destino.id } });
    if (!comprobante || comprobante.estado === 'PAGADO') return false;
    const nuevoSaldo = redondear2(Math.max(0, Number(comprobante.saldoPendiente) - monto));
    // Actualización condicionada al saldo leído: si otro pago lo cambió, no se pisa.
    const r = await tx.comprobante.updateMany({
      where: { id: destino.id, saldoPendiente: comprobante.saldoPendiente, estado: { in: ['PENDIENTE', 'PARCIAL'] } },
      data: {
        saldoPendiente: nuevoSaldo.toFixed(2),
        estado: nuevoSaldo < 0.005 ? 'PAGADO' : 'PARCIAL',
      },
    });
    return r.count === 1;
  }

  private async aprenderCuenta(tx: Transaccion, clienteId: string, cuenta: string, banco: string | null) {
    await tx.cuentaOrigenCliente.upsert({
      where: { clienteId_cuenta: { clienteId, cuenta } },
      create: { clienteId, cuenta, banco },
      update: { vecesVista: { increment: 1 }, ultimaVez: new Date() },
    });
  }

  private async describirDestino(destino: Destino, moneda: 'PEN' | 'USD') {
    if (destino.tipo === 'PEDIDO') {
      const p = await this.db.pedidoCaja.findUnique({ where: { id: destino.id }, include: { cliente: true } });
      if (!p || p.estado !== 'ABIERTO') throw new ErrorConciliacion(409, 'El pedido ya no está abierto.');
      if (p.moneda !== moneda) throw new ErrorConciliacion(400, 'El pedido está en otra moneda.');
      return {
        pendiente: Number(p.monto),
        clienteId: p.clienteId,
        clienteNombre: p.cliente?.nombre ?? null,
        descripcion: `Pedido ${p.caja} ${formatearSoles(Number(p.monto), p.moneda)}`,
      };
    }
    const c = await this.db.comprobante.findUnique({ where: { id: destino.id }, include: { cliente: true } });
    if (!c || c.estado === 'PAGADO') throw new ErrorConciliacion(409, 'El comprobante ya no está pendiente.');
    if (c.moneda !== moneda) throw new ErrorConciliacion(400, 'El comprobante está en otra moneda.');
    return {
      pendiente: Number(c.saldoPendiente),
      clienteId: c.clienteId,
      clienteNombre: c.cliente.nombre,
      descripcion: `${c.serie}-${c.numero} ${c.cliente.nombre}`,
    };
  }

  private async publicar(movimientoId: string): Promise<void> {
    const m = await this.db.movimiento.findUnique({ where: { id: movimientoId }, include: INCLUIR_VISTA });
    if (m) this.bus.emit('movimiento.actualizado', aVista(m));
  }
}
