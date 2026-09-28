import { describe, expect, it } from 'vitest';
import { hoyLima, rangoDiaLima } from '../util/fechas.js';
import { enmascarar, vistaParaRol, type MovimientoVista } from './vista.js';
import { BusEventos } from '../eventos/bus.js';

describe('fechas en hora de Lima', () => {
  it('el día de Lima empieza a las 05:00 UTC', () => {
    expect(rangoDiaLima('2026-09-28')).toEqual({
      desde: new Date('2026-09-28T05:00:00.000Z'),
      hasta: new Date('2026-09-29T05:00:00.000Z'),
    });
  });

  it('a las 23:30 de Lima todavía es "hoy" aunque en UTC ya sea mañana', () => {
    expect(hoyLima(new Date('2026-09-29T04:30:00Z'))).toBe('2026-09-28');
    expect(hoyLima(new Date('2026-09-29T05:00:00Z'))).toBe('2026-09-29');
  });

  it('rechaza fechas inválidas', () => {
    expect(() => rangoDiaLima('28/09/2026')).toThrow();
    expect(() => rangoDiaLima('2026-13-45')).toThrow();
  });
});

describe('minimización de datos por rol', () => {
  const m: MovimientoVista = {
    id: '1',
    idBanco: 'b1',
    cuentaId: 'bcp-pen-01',
    banco: 'BCP',
    fechaHora: '2026-09-28T15:00:00.000Z',
    monto: 350,
    moneda: 'PEN',
    canal: 'INTERBANCARIA',
    numeroOperacion: '123456',
    ordenanteNombre: 'JUAN C QUISPE M',
    ordenanteTipoDoc: 'DNI',
    ordenanteNumeroDoc: '45678912',
    ordenanteBanco: 'BBVA',
    ordenanteCuenta: '01110300020045678123',
    referencia: 'F001-2345',
    estado: 'POR_CONCILIAR',
  };

  it('enmascara dejando los últimos 4 caracteres', () => {
    expect(enmascarar('45678912')).toBe('****8912');
    expect(enmascarar('191-1234567-0-12')).toBe('****7012');
    expect(enmascarar('123')).toBe('****');
    expect(enmascarar(null)).toBeNull();
  });

  it('Caja y Ventas ven el documento y la cuenta enmascarados', () => {
    for (const rol of ['CAJA', 'VENTAS'] as const) {
      const v = vistaParaRol(m, rol);
      expect(v.ordenanteNumeroDoc).toBe('****8912');
      expect(v.ordenanteCuenta).toBe('****8123');
      expect(v.ordenanteNombre).toBe('JUAN C QUISPE M');
      expect(v.monto).toBe(350);
    }
  });

  it('Finanzas ve los datos completos', () => {
    expect(vistaParaRol(m, 'FINANZAS')).toEqual(m);
  });
});

describe('BusEventos', () => {
  it('entrega el evento y permite dejar de escuchar', () => {
    const bus = new BusEventos();
    const recibidos: string[] = [];
    const dejar = bus.on('movimiento.registrado', (m) => recibidos.push(m.id));
    bus.emit('movimiento.registrado', { id: 'a' } as MovimientoVista);
    dejar();
    bus.emit('movimiento.registrado', { id: 'b' } as MovimientoVista);
    expect(recibidos).toEqual(['a']);
    expect(bus.oyentes('movimiento.registrado')).toBe(0);
  });
});
