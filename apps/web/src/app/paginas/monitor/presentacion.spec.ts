import type { Filtros, Movimiento, Resumen } from './monitor-api';
import { cumpleFiltros, horaLima, hoyLima, leerMonto, sumarAlResumen } from './presentacion';

const HOY = hoyLima();
const base: Movimiento = {
  id: '1',
  idBanco: 'b1',
  cuentaId: 'bcp-pen-01',
  banco: 'BCP',
  fechaHora: new Date().toISOString(),
  monto: 350,
  moneda: 'PEN',
  canal: 'YAPE',
  numeroOperacion: '12345678',
  ordenanteNombre: 'JUAN C QUISPE M',
  ordenanteTipoDoc: null,
  ordenanteNumeroDoc: null,
  ordenanteBanco: 'BCP',
  ordenanteCuenta: null,
  referencia: 'pedido 12',
  estado: 'POR_CONCILIAR',
};
const sinFiltros: Filtros = { fecha: HOY, cuentaId: '', canal: '', estado: '', q: '', monto: null };

describe('leerMonto', () => {
  it('entiende cómo digita el cajero', () => {
    expect(leerMonto('350')).toBe(350);
    expect(leerMonto('350.5')).toBe(350.5);
    expect(leerMonto('1,250.50')).toBe(1250.5);
    expect(leerMonto('S/ 80')).toBe(80);
    expect(leerMonto(' 99.90 ')).toBe(99.9);
  });

  it('ignora lo que no es un monto válido', () => {
    expect(leerMonto('')).toBeNull();
    expect(leerMonto('abc')).toBeNull();
    expect(leerMonto('0')).toBeNull();
    expect(leerMonto('12.345')).toBeNull();
  });
});

describe('cumpleFiltros (abonos que llegan en vivo)', () => {
  it('muestra el abono de hoy sin filtros', () => {
    expect(cumpleFiltros(base, sinFiltros)).toBe(true);
  });

  it('respeta canal, cuenta, monto y texto', () => {
    expect(cumpleFiltros(base, { ...sinFiltros, canal: 'PLIN' })).toBe(false);
    expect(cumpleFiltros(base, { ...sinFiltros, cuentaId: 'ibk-pen-01' })).toBe(false);
    expect(cumpleFiltros(base, { ...sinFiltros, monto: 350 })).toBe(true);
    expect(cumpleFiltros(base, { ...sinFiltros, monto: 351 })).toBe(false);
    expect(cumpleFiltros(base, { ...sinFiltros, q: 'quispe' })).toBe(true);
    expect(cumpleFiltros(base, { ...sinFiltros, q: 'rojas' })).toBe(false);
  });

  it('no mezcla abonos de hoy cuando se revisa otro día', () => {
    expect(cumpleFiltros(base, { ...sinFiltros, fecha: '2020-01-01' })).toBe(false);
  });
});

describe('sumarAlResumen', () => {
  it('suma el abono al canal y al total de su moneda', () => {
    const r: Resumen = {
      fecha: HOY,
      porCanal: [{ canal: 'YAPE', moneda: 'PEN', cantidad: 2, total: 100.1 }],
      totales: [{ moneda: 'PEN', cantidad: 2, total: 100.1 }],
    };
    const nuevo = sumarAlResumen(r, { ...base, monto: 0.2 });
    expect(nuevo.porCanal[0]).toEqual({ canal: 'YAPE', moneda: 'PEN', cantidad: 3, total: 100.3 });
    expect(nuevo.totales[0]).toEqual({ moneda: 'PEN', cantidad: 3, total: 100.3 });
    const usd = sumarAlResumen(r, { ...base, moneda: 'USD', canal: 'TRANSFERENCIA', monto: 500 });
    expect(usd.totales).toContainEqual({ moneda: 'USD', cantidad: 1, total: 500 });
  });
});

describe('horaLima', () => {
  it('muestra la hora de Lima sin importar la zona del equipo', () => {
    expect(horaLima('2026-09-28T15:04:05.000Z')).toBe('10:04:05');
  });
});
