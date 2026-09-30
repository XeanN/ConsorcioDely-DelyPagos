import type { BaseDatos } from '../db/prisma.js';
import type { UsuarioSesion } from '../auth/tipos.js';
import { actorDe } from '../auth/plugin-auth.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';

export interface ComprobanteErp {
  tipo: 'FACTURA' | 'BOLETA';
  serie: string;
  numero: number;
  fechaEmision: string;
  fechaVencimiento: string;
  total: number;
  saldoPendiente?: number;
  moneda: 'PEN' | 'USD';
  cliente: {
    tipoDoc: 'DNI' | 'RUC' | 'CE';
    numeroDoc: string;
    nombre: string;
    tipo?: 'MAYORISTA' | 'MINORISTA' | 'CONSUMIDOR_FINAL';
  };
}

export interface ResultadoSincronizacion {
  creados: number;
  actualizados: number;
  sinCambios: number;
  /** Comprobantes ya cobrados aquí: se conserva el saldo de Dely Pagos, no el del ERP. */
  conservados: string[];
}

const estadoPara = (saldo: number, total: number) =>
  saldo < 0.005 ? 'PAGADO' : saldo < total - 0.005 ? 'PARCIAL' : 'PENDIENTE';

/**
 * Recibe los comprobantes emitidos por el ERP (idempotente: se puede reenviar el mismo lote).
 * Si Dely Pagos ya aplicó pagos a un comprobante, su saldo se conserva para no deshacer cobros.
 */
export async function sincronizarComprobantes(
  db: BaseDatos,
  lote: ComprobanteErp[],
  sesion: UsuarioSesion,
): Promise<ResultadoSincronizacion> {
  const resultado: ResultadoSincronizacion = { creados: 0, actualizados: 0, sinCambios: 0, conservados: [] };

  for (const c of lote) {
    const cliente = await db.cliente.upsert({
      where: { tipoDoc_numeroDoc: { tipoDoc: c.cliente.tipoDoc, numeroDoc: c.cliente.numeroDoc } },
      create: {
        tipoDoc: c.cliente.tipoDoc,
        numeroDoc: c.cliente.numeroDoc,
        nombre: c.cliente.nombre,
        tipo: c.cliente.tipo ?? (c.cliente.numeroDoc.startsWith('20') ? 'MAYORISTA' : 'MINORISTA'),
      },
      update: { nombre: c.cliente.nombre },
    });

    const saldoErp = Math.min(c.saldoPendiente ?? c.total, c.total);
    const existente = await db.comprobante.findUnique({
      where: { serie_numero: { serie: c.serie, numero: c.numero } },
      include: { conciliaciones: { where: { estado: 'CONCILIADO' }, select: { id: true }, take: 1 } },
    });

    if (!existente) {
      await db.comprobante.create({
        data: {
          tipo: c.tipo,
          serie: c.serie,
          numero: c.numero,
          clienteId: cliente.id,
          fechaEmision: new Date(c.fechaEmision),
          fechaVencimiento: new Date(c.fechaVencimiento),
          total: c.total.toFixed(2),
          saldoPendiente: saldoErp.toFixed(2),
          moneda: c.moneda,
          estado: estadoPara(saldoErp, c.total),
        },
      });
      resultado.creados++;
      continue;
    }

    const cobradoAqui = existente.conciliaciones.length > 0;
    const saldo = cobradoAqui ? Number(existente.saldoPendiente) : saldoErp;
    if (cobradoAqui && Math.abs(saldo - saldoErp) >= 0.005) resultado.conservados.push(`${c.serie}-${c.numero}`);

    const cambia =
      Number(existente.total) !== c.total ||
      Number(existente.saldoPendiente) !== saldo ||
      existente.fechaVencimiento.toISOString().slice(0, 10) !== c.fechaVencimiento.slice(0, 10);
    if (!cambia) {
      resultado.sinCambios++;
      continue;
    }
    await db.comprobante.update({
      where: { id: existente.id },
      data: {
        total: c.total.toFixed(2),
        saldoPendiente: saldo.toFixed(2),
        fechaVencimiento: new Date(c.fechaVencimiento),
        estado: estadoPara(saldo, c.total),
      },
    });
    resultado.actualizados++;
  }

  const actor = actorDe(sesion);
  await registrarAuditoria(db, {
    usuarioId: actor.usuarioId,
    accion: 'COMPROBANTES_SINCRONIZADOS',
    entidad: 'comprobante',
    datos: { ...actor.datos, recibidos: lote.length, ...resultado },
  });
  return resultado;
}
