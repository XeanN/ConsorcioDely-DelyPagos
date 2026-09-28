import type { BaseDatos } from '../db/prisma.js';
import type { PagoEsperado } from '../banco/mock/generador.js';
import { Aleatorio } from './aleatorio.js';

/** Abrevia un nombre como suelen mostrarlo los bancos: "JUAN C QUISPE M". */
function abreviar(nombre: string, a: Aleatorio): string {
  const partes = nombre.split(' ');
  if (partes.length < 3 || /S\.A\.C\.|E\.I\.R\.L\.|S\.R\.L\.|S\.A\./.test(nombre)) {
    return a.probabilidad(0.5) ? nombre.replace(/\s+(S\.A\.C\.|E\.I\.R\.L\.|S\.R\.L\.|S\.A\.)$/, '') : nombre;
  }
  return a.elegir([
    nombre,
    `${partes[0]} ${partes[partes.length - 2]} ${partes[partes.length - 1]![0]}`,
    `${partes[0]} ${partes[partes.length - 2]}`,
  ]);
}

/**
 * Solo para el banco simulado: le entrega pedidos abiertos y facturas pendientes
 * reales para que algunos abonos correspondan a pagos esperados (como en la tienda).
 * El banco real no usa esto.
 */
export function crearFuentePagosEsperados(db: BaseDatos, semilla = Date.now()) {
  const a = new Aleatorio(semilla);
  return async (): Promise<PagoEsperado[]> => {
    const [pedidos, comprobantes] = await Promise.all([
      db.pedidoCaja.findMany({
        where: { estado: 'ABIERTO' },
        include: { cliente: { select: { nombre: true } } },
        take: 20,
      }),
      db.comprobante.findMany({
        where: { estado: { in: ['PENDIENTE', 'PARCIAL'] } },
        include: { cliente: { select: { nombre: true, tipoDoc: true, numeroDoc: true } } },
        orderBy: { fechaEmision: 'asc' },
        take: 40,
      }),
    ]);

    const dePedidos: PagoEsperado[] = pedidos.map((p) => ({
      monto: Number(p.monto),
      moneda: p.moneda,
      nombre: p.cliente ? abreviar(p.cliente.nombre, a) : undefined,
    }));

    const deComprobantes: PagoEsperado[] = comprobantes.map((c) => {
      const saldo = Number(c.saldoPendiente);
      // A veces el mayorista paga solo una parte.
      const monto = a.probabilidad(0.2) ? Math.round(saldo * a.monto(0.3, 0.7) * 100) / 100 : saldo;
      const numero = String(c.numero);
      const referencia = a.elegirPonderado<string | undefined>([
        [`${c.serie}-${numero}`, 3],
        [`PAGO FACT ${c.serie}-${numero.padStart(8, '0')}`, 2],
        [`${c.serie} ${numero}`, 1],
        [undefined, 3],
      ]);
      return {
        monto,
        moneda: c.moneda,
        nombre: abreviar(c.cliente.nombre, a),
        tipoDoc: c.cliente.tipoDoc,
        numeroDoc: a.probabilidad(0.5) ? c.cliente.numeroDoc : undefined,
        referencia,
      };
    });

    return [...dePedidos, ...deComprobantes];
  };
}
