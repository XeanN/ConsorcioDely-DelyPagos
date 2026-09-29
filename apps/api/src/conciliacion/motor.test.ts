import { describe, expect, it } from 'vitest';
import {
  conciliar,
  type ClienteCandidato,
  type ComprobanteCandidato,
  type MovimientoAConciliar,
  type PedidoCandidato,
} from './motor.js';
import { similitudNombres } from './similitud.js';
import { extraerIdentificadores } from './identificadores.js';

const AHORA = new Date('2026-09-29T15:00:00Z');
const haceMin = (min: number) => new Date(AHORA.getTime() - min * 60_000);

const juan: ClienteCandidato = {
  id: 'c-juan',
  nombre: 'JUAN CARLOS QUISPE MAMANI',
  tipoDoc: 'DNI',
  numeroDoc: '45678912',
  alias: [],
  cuentasOrigen: [],
};
const distribuidora: ClienteCandidato = {
  id: 'c-dist',
  nombre: 'DISTRIBUIDORA HUAMAN PUNO S.A.C.',
  tipoDoc: 'RUC',
  numeroDoc: '20512345678',
  alias: [],
  cuentasOrigen: ['1911234567012'],
};
const rosa: ClienteCandidato = {
  id: 'c-rosa',
  nombre: 'ROSA ELENA CONDORI APAZA',
  tipoDoc: 'DNI',
  numeroDoc: '41234567',
  alias: [],
  cuentasOrigen: [],
};

function mov(p: Partial<MovimientoAConciliar>): MovimientoAConciliar {
  return {
    monto: 350,
    moneda: 'PEN',
    fechaHora: AHORA,
    ordenanteNombre: null,
    ordenanteNumeroDoc: null,
    ordenanteCuenta: null,
    referencia: null,
    ...p,
  };
}
function pedido(p: Partial<PedidoCandidato> & { id: string }): PedidoCandidato {
  return { tipo: 'PEDIDO', monto: 350, moneda: 'PEN', creadoEn: haceMin(5), tienda: 'Tienda Central', caja: 'Caja 1', cliente: null, ...p };
}
function factura(p: Partial<ComprobanteCandidato> & { id: string; numero: number }): ComprobanteCandidato {
  return {
    tipo: 'COMPROBANTE',
    serie: 'F001',
    saldoPendiente: 5000,
    moneda: 'PEN',
    fechaEmision: new Date('2026-08-01'),
    cliente: distribuidora,
    ...p,
  };
}

describe('escenarios de la presentación', () => {
  it('1. Yape exacto de un pedido en caja → CONCILIADO', () => {
    const r = conciliar(mov({ monto: 350, ordenanteNombre: 'JUAN C QUISPE M' }), [
      pedido({ id: 'p1', monto: 350 }),
      pedido({ id: 'p2', monto: 120 }),
    ]);
    expect(r.estado).toBe('CONCILIADO');
    expect(r.destino).toMatchObject({ tipo: 'PEDIDO', id: 'p1' });
    expect(r.motivos).toContain('monto exacto');
  });

  it('2. Mayorista con referencia de factura y nombre abreviado → CONCILIADO por referencia', () => {
    const r = conciliar(
      mov({ monto: 5000, ordenanteNombre: 'DISTRIB. H. PUNO', referencia: 'PAGO FACT F001-00002345' }),
      [factura({ id: 'f1', numero: 2345 }), factura({ id: 'f2', numero: 2346 })],
    );
    expect(r.estado).toBe('CONCILIADO');
    expect(r.destino?.id).toBe('f1');
    expect(r.motivos).toContain('referencia F001-2345');
  });

  it('3. Pago de un familiar → PROBABLE (requiere confirmación)', () => {
    const r = conciliar(mov({ monto: 780, ordenanteNombre: 'MARIA QUISPE MAMANI' }), [
      factura({ id: 'b1', serie: 'B001', numero: 5500, saldoPendiente: 780, cliente: juan }),
    ]);
    expect(r.estado).toBe('PROBABLE');
    expect(r.destino?.id).toBe('b1');
    expect(r.motivos).toContain('mismo apellido, otro nombre (¿familiar?)');
  });

  it('3b. Tras confirmar, el alias aprendido concilia solo la próxima vez', () => {
    const conAlias = { ...juan, alias: ['MARIA QUISPE MAMANI'] };
    const r = conciliar(mov({ monto: 780, ordenanteNombre: 'MARIA QUISPE MAMANI' }), [
      factura({ id: 'b1', serie: 'B001', numero: 5500, saldoPendiente: 780, cliente: conAlias }),
    ]);
    expect(r.estado).toBe('CONCILIADO');
    expect(r.motivos).toContain('nombre conocido (alias "MARIA QUISPE MAMANI")');
  });

  it('4. Dos pedidos del mismo monto → PROBABLE con candidatos, nunca automático', () => {
    const r = conciliar(mov({ monto: 350, ordenanteNombre: 'LUIS TORRES' }), [
      pedido({ id: 'p1', monto: 350, caja: 'Caja 1' }),
      pedido({ id: 'p2', monto: 350, caja: 'Caja 2' }),
    ]);
    expect(r.estado).toBe('PROBABLE');
    expect(r.candidatos.map((c) => c.id).sort()).toEqual(['p1', 'p2']);
    expect(r.motivos.join(' ')).toMatch(/2 candidatos con el mismo monto/);
  });

  it('5. Pago parcial de mayorista identificado → CONCILIADO parcial al comprobante más antiguo', () => {
    const r = conciliar(
      mov({ monto: 2000, ordenanteNombre: 'DISTRIBUIDORA HUAMAN PUNO', ordenanteCuenta: '191-1234567-0-12' }),
      [
        factura({ id: 'nueva', numero: 2400, saldoPendiente: 8000, fechaEmision: new Date('2026-09-10') }),
        factura({ id: 'antigua', numero: 2100, saldoPendiente: 6000, fechaEmision: new Date('2026-07-01') }),
      ],
    );
    expect(r.estado).toBe('CONCILIADO');
    expect(r.destino).toMatchObject({ id: 'antigua', esParcial: true, montoAplicado: 2000 });
    expect(r.motivos).toContain('cuenta de origen conocida');
  });
});

describe('reglas de seguridad y bordes', () => {
  it('un pedido fuera de la ventana de 30 minutos no es candidato', () => {
    const r = conciliar(mov({ monto: 350 }), [pedido({ id: 'viejo', creadoEn: haceMin(45) })]);
    expect(r.estado).toBe('SIN_IDENTIFICAR');
  });

  it('no mezcla monedas', () => {
    const r = conciliar(mov({ monto: 350, moneda: 'USD' }), [pedido({ id: 'p1' })]);
    expect(r.estado).toBe('SIN_IDENTIFICAR');
  });

  it('un comprobante con el mismo monto pero otro nombre no se concilia', () => {
    const r = conciliar(mov({ monto: 780, ordenanteNombre: 'PEDRO VARGAS ROJAS' }), [
      factura({ id: 'b1', numero: 1, saldoPendiente: 780, cliente: rosa }),
    ]);
    expect(r.estado).toBe('SIN_IDENTIFICAR');
  });

  it('un comprobante nunca se concilia solo por monto', () => {
    const r = conciliar(mov({ monto: 780 }), [factura({ id: 'b1', numero: 1, saldoPendiente: 780, cliente: rosa })]);
    expect(r.estado).toBe('PROBABLE');
  });

  it('un pago parcial sin identidad fuerte queda PROBABLE', () => {
    const r = conciliar(mov({ monto: 2000, ordenanteNombre: 'DISTRIBUIDORA HUAMAN PUNO' }), [
      factura({ id: 'f1', numero: 1, saldoPendiente: 6000 }),
    ]);
    expect(r.estado).toBe('PROBABLE');
    expect(r.destino?.esParcial).toBe(true);
  });

  it('un pago mayor que el saldo no se aplica a ese comprobante', () => {
    const r = conciliar(mov({ monto: 9000, referencia: 'F001-1' }), [factura({ id: 'f1', numero: 1, saldoPendiente: 5000 })]);
    expect(r.estado).toBe('SIN_IDENTIFICAR');
  });

  it('acepta diferencias de redondeo con menor puntaje', () => {
    const r = conciliar(mov({ monto: 349.9, ordenanteNombre: 'JUAN CARLOS QUISPE MAMANI' }), [
      factura({ id: 'b1', numero: 1, saldoPendiente: 350, cliente: juan }),
    ]);
    expect(r.destino?.id).toBe('b1');
    expect(r.motivos.join(' ')).toMatch(/monto cercano/);
  });

  it('el documento del ordenante identifica al cliente aunque el nombre llegue distinto', () => {
    const r = conciliar(mov({ monto: 780, ordenanteNombre: 'M QUISPE', ordenanteNumeroDoc: '45678912' }), [
      factura({ id: 'b1', numero: 1, saldoPendiente: 780, cliente: juan }),
    ]);
    expect(r.estado).toBe('CONCILIADO');
    expect(r.motivos).toContain('documento del cliente (DNI)');
  });

  it('a igual evidencia prefiere el pedido en caja sobre la factura', () => {
    const r = conciliar(mov({ monto: 350, ordenanteNombre: 'JUAN C QUISPE M' }), [
      factura({ id: 'b1', numero: 1, saldoPendiente: 350, cliente: juan }),
      pedido({ id: 'p1', cliente: juan }),
    ]);
    expect(r.destino?.tipo).toBe('PEDIDO');
  });

  it('sin candidatos → SIN_IDENTIFICAR con motivo claro', () => {
    const r = conciliar(mov({}), []);
    expect(r).toMatchObject({ estado: 'SIN_IDENTIFICAR', destino: null });
    expect(r.motivos).toEqual(['sin pedidos ni comprobantes compatibles']);
  });
});

describe('similitudNombres', () => {
  it.each([
    ['JUAN C QUISPE M', 'JUAN CARLOS QUISPE MAMANI', 0.85],
    ['JUAN QUISPE', 'JUAN CARLOS QUISPE MAMANI', 0.9],
    ['DISTRIB. HUAMAN PUNO', 'DISTRIBUIDORA HUAMAN PUNO S.A.C.', 0.9],
    ['José Cáceres', 'JOSE CACERES', 1],
    ['QUISPE MAMANI JUAN', 'JUAN QUISPE MAMANI', 0.9],
  ])('"%s" ≈ "%s" (≥ %s)', (a, b, minimo) => {
    expect(similitudNombres(a, b).valor).toBeGreaterThanOrEqual(minimo);
  });

  it.each([
    ['PEDRO VARGAS', 'JUAN CARLOS QUISPE MAMANI'],
    ['JUAN', 'JUAN CARLOS QUISPE MAMANI'],
    ['COMERCIAL ROJAS', 'DISTRIBUIDORA HUAMAN PUNO'],
  ])('"%s" no se parece a "%s"', (a, b) => {
    expect(similitudNombres(a, b).valor).toBeLessThan(0.6);
  });

  it('detecta a un posible familiar (mismos apellidos, otro nombre)', () => {
    const r = similitudNombres('MARIA QUISPE MAMANI', 'JUAN CARLOS QUISPE MAMANI');
    expect(r.posibleFamiliar).toBe(true);
    expect(r.valor).toBeLessThanOrEqual(0.6);
  });

  it('tolera un error de tipeo', () => {
    expect(similitudNombres('ROSA CONDORY APAZA', 'ROSA CONDORI APAZA').valor).toBeGreaterThan(0.8);
  });
});

describe('extraerIdentificadores', () => {
  it.each([
    ['PAGO F001-2345', 'F001-2345'],
    ['F001-00002345', 'F001-2345'],
    ['f001 2345', 'F001-2345'],
    ['FACT 001-2345', 'F001-2345'],
    ['FACTURA 001 2345', 'F001-2345'],
    ['BOL 001-99', 'B001-99'],
    ['F001 N° 45', 'F001-45'],
  ])('"%s" → %s', (texto, esperado) => {
    expect([...extraerIdentificadores(texto, null).comprobantes]).toEqual([esperado]);
  });

  it('no confunde el número de una factura con un DNI', () => {
    const ids = extraerIdentificadores('PAGO F001-00002345 RUC 20512345678', null);
    expect([...ids.documentos]).toEqual(['20512345678']);
  });

  it('incluye el documento que envía el banco', () => {
    expect([...extraerIdentificadores(null, '45678912').documentos]).toEqual(['45678912']);
  });
});
