import type { Rol } from '../auth/tipos.js';

export type EstadoMovimiento =
  | 'POR_CONCILIAR'
  | 'CONCILIADO'
  | 'PROBABLE'
  | 'SIN_IDENTIFICAR'
  | 'DESCARTADO';

/** Movimiento tal como lo ve la web y las integraciones. */
export interface MovimientoVista {
  id: string;
  idBanco: string;
  cuentaId: string;
  banco: string;
  fechaHora: string;
  monto: number;
  moneda: 'PEN' | 'USD';
  canal: 'TRANSFERENCIA' | 'INTERBANCARIA' | 'YAPE' | 'PLIN' | 'DEPOSITO_AGENCIA';
  numeroOperacion: string;
  ordenanteNombre: string | null;
  ordenanteTipoDoc: 'DNI' | 'RUC' | 'CE' | null;
  ordenanteNumeroDoc: string | null;
  ordenanteBanco: string | null;
  ordenanteCuenta: string | null;
  referencia: string | null;
  estado: EstadoMovimiento;
}

interface RegistroMovimiento {
  id: string;
  idBanco: string;
  cuentaId: string;
  fechaHora: Date;
  monto: { toString(): string };
  moneda: 'PEN' | 'USD';
  canal: MovimientoVista['canal'];
  numeroOperacion: string;
  ordenanteNombre: string | null;
  ordenanteTipoDoc: MovimientoVista['ordenanteTipoDoc'];
  ordenanteNumeroDoc: string | null;
  ordenanteBanco: string | null;
  ordenanteCuenta: string | null;
  referencia: string | null;
  cuenta: { banco: string };
  conciliaciones: { estado: Exclude<EstadoMovimiento, 'POR_CONCILIAR'> }[];
}

/** Incluir en las consultas para poder construir la vista. */
export const INCLUIR_VISTA = {
  cuenta: { select: { banco: true } },
  conciliaciones: { select: { estado: true }, orderBy: { creadoEn: 'desc' as const }, take: 1 },
};

export function aVista(m: RegistroMovimiento): MovimientoVista {
  return {
    id: m.id,
    idBanco: m.idBanco,
    cuentaId: m.cuentaId,
    banco: m.cuenta.banco,
    fechaHora: m.fechaHora.toISOString(),
    monto: Number(m.monto.toString()),
    moneda: m.moneda,
    canal: m.canal,
    numeroOperacion: m.numeroOperacion,
    ordenanteNombre: m.ordenanteNombre,
    ordenanteTipoDoc: m.ordenanteTipoDoc,
    ordenanteNumeroDoc: m.ordenanteNumeroDoc,
    ordenanteBanco: m.ordenanteBanco,
    ordenanteCuenta: m.ordenanteCuenta,
    referencia: m.referencia,
    estado: m.conciliaciones[0]?.estado ?? 'POR_CONCILIAR',
  };
}

/** Deja visibles solo los últimos 4 caracteres: "****5678". */
export function enmascarar(valor: string | null): string | null {
  if (!valor) return valor;
  const limpio = valor.replace(/[\s-]/g, '');
  return limpio.length <= 4 ? '****' : `****${limpio.slice(-4)}`;
}

/**
 * Minimización de datos (Ley 29733): Caja y Ventas no necesitan el documento ni la
 * cuenta completa del ordenante para saber si llegó un pago. Finanzas y Admin sí.
 */
export function vistaParaRol(m: MovimientoVista, rol: Rol): MovimientoVista {
  if (rol === 'FINANZAS' || rol === 'ADMIN') return m;
  return {
    ...m,
    ordenanteNumeroDoc: enmascarar(m.ordenanteNumeroDoc),
    ordenanteCuenta: enmascarar(m.ordenanteCuenta),
  };
}
