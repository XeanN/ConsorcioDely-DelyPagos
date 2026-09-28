import type { Canal, EstadoMovimiento, Filtros, Movimiento, Resumen } from './monitor-api';

export const CANALES: { valor: Canal; etiqueta: string; clase: string }[] = [
  { valor: 'YAPE', etiqueta: 'Yape', clase: 'bg-purple-100 text-purple-800' },
  { valor: 'PLIN', etiqueta: 'Plin', clase: 'bg-cyan-100 text-cyan-800' },
  { valor: 'TRANSFERENCIA', etiqueta: 'Transferencia', clase: 'bg-blue-100 text-blue-800' },
  { valor: 'INTERBANCARIA', etiqueta: 'Interbancaria', clase: 'bg-indigo-100 text-indigo-800' },
  { valor: 'DEPOSITO_AGENCIA', etiqueta: 'Depósito', clase: 'bg-amber-100 text-amber-900' },
];

export const ESTADOS: { valor: EstadoMovimiento; etiqueta: string; clase: string }[] = [
  { valor: 'POR_CONCILIAR', etiqueta: 'Por conciliar', clase: 'bg-slate-100 text-slate-700' },
  { valor: 'CONCILIADO', etiqueta: 'Conciliado', clase: 'bg-emerald-100 text-emerald-800' },
  { valor: 'PROBABLE', etiqueta: 'Probable', clase: 'bg-amber-100 text-amber-900' },
  { valor: 'SIN_IDENTIFICAR', etiqueta: 'Sin identificar', clase: 'bg-red-100 text-red-800' },
  { valor: 'DESCARTADO', etiqueta: 'Descartado', clase: 'bg-slate-200 text-slate-500 line-through' },
];

export const canal = (valor: Canal) => CANALES.find((c) => c.valor === valor)!;
export const estado = (valor: EstadoMovimiento) => ESTADOS.find((e) => e.valor === valor)!;

/** Hora en Lima (HH:MM:SS), sin depender de la zona horaria del equipo de caja. */
export function horaLima(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour12: false });
}

/** Fecha de hoy en Lima (AAAA-MM-DD). */
export function hoyLima(ahora = new Date()): string {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Convierte lo que digita el cajero ("350", "1,250.50", "S/ 80") en un monto. */
export function leerMonto(texto: string): number | null {
  const limpio = texto.replace(/s\/|us\$|\s/gi, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null;
  const valor = Number(limpio);
  return valor > 0 ? valor : null;
}

/** ¿Un movimiento que llega en vivo corresponde a los filtros que la pantalla está mostrando? */
export function cumpleFiltros(m: Movimiento, f: Filtros): boolean {
  if (hoyLima(new Date(m.fechaHora)) !== f.fecha) return false;
  if (f.cuentaId && m.cuentaId !== f.cuentaId) return false;
  if (f.canal && m.canal !== f.canal) return false;
  if (f.estado && m.estado !== f.estado) return false;
  if (f.monto !== null && Math.abs(m.monto - f.monto) >= 0.005) return false;
  const q = f.q.trim().toLowerCase();
  if (q.length >= 2) {
    const texto = `${m.ordenanteNombre ?? ''} ${m.referencia ?? ''} ${m.numeroOperacion}`.toLowerCase();
    if (!texto.includes(q)) return false;
  }
  return true;
}

/** Suma un abono que llegó en vivo a los totales del día, sin volver a consultar la API. */
export function sumarAlResumen(r: Resumen, m: Movimiento): Resumen {
  const porCanal = [...r.porCanal];
  const i = porCanal.findIndex((g) => g.canal === m.canal && g.moneda === m.moneda);
  if (i >= 0) {
    const g = porCanal[i]!;
    porCanal[i] = { ...g, cantidad: g.cantidad + 1, total: Math.round((g.total + m.monto) * 100) / 100 };
  } else {
    porCanal.push({ canal: m.canal, moneda: m.moneda, cantidad: 1, total: m.monto });
  }
  const totales = [...r.totales];
  const j = totales.findIndex((t) => t.moneda === m.moneda);
  if (j >= 0) {
    const t = totales[j]!;
    totales[j] = { ...t, cantidad: t.cantidad + 1, total: Math.round((t.total + m.monto) * 100) / 100 };
  } else {
    totales.push({ moneda: m.moneda, cantidad: 1, total: m.monto });
  }
  return { ...r, porCanal, totales };
}
