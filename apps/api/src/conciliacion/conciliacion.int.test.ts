import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../app.js';
import { cargarConfig, configMotor } from '../config.js';
import { hashearClave } from '../auth/claves.js';
import { BusEventos } from '../eventos/bus.js';
import { MockBankProvider } from '../banco/mock/mock-bank-provider.js';
import type { Movimiento } from '../banco/tipos.js';
import { IngestaMovimientos } from '../movimientos/ingesta.js';
import { ServicioConciliacion } from './servicio-conciliacion.js';
import { verificarCadena } from '../auditoria/auditoria.js';
import { URL_PRUEBAS, crearBaseDatosPruebas, limpiarBaseDatos } from '../test/bd-pruebas.js';
import type { BaseDatos } from '../db/prisma.js';
import type { MovimientoVista } from '../movimientos/vista.js';

const CONFIG = cargarConfig({
  NODE_ENV: 'test',
  JWT_SECRETO: 'secreto-de-pruebas-con-mas-de-32-caracteres',
  LOGIN_LIMITE_POR_MINUTO: '1000',
  RATE_LIMIT_MAX: '1000',
});
const CLAVE = 'ClavePrueba-X1';
const ORIGEN = 'http://localhost:4200';
const silencioso = { info: () => {}, warn: () => {}, error: () => {} };
let secuencia = 0;

describe.skipIf(!URL_PRUEBAS)('conciliación (integración)', () => {
  let db: BaseDatos;
  let bus: BusEventos;
  let app: Awaited<ReturnType<typeof construirApp>>;
  let ingesta: IngestaMovimientos;
  let servicio: ServicioConciliacion;
  let juanId: string;
  let distId: string;

  beforeAll(async () => {
    db = crearBaseDatosPruebas();
    bus = new BusEventos();
    app = await construirApp(CONFIG, { db, bus });
    servicio = new ServicioConciliacion(db, bus, configMotor(CONFIG), silencioso);
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDatos(db);
    const hashClave = await hashearClave(CLAVE);
    await db.usuario.createMany({
      data: [
        { usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA', hashClave },
        { usuario: 'ventas1', nombre: 'Ventas 1', rol: 'VENTAS', hashClave },
      ],
    });
    ingesta = new IngestaMovimientos(db, new MockBankProvider({ semilla: 1, historialDias: 0 }), bus, silencioso);
    await ingesta.prepararCuentas();
    juanId = (
      await db.cliente.create({
        data: { tipoDoc: 'DNI', numeroDoc: '45678912', nombre: 'JUAN CARLOS QUISPE MAMANI', tipo: 'MINORISTA' },
      })
    ).id;
    distId = (
      await db.cliente.create({
        data: { tipoDoc: 'RUC', numeroDoc: '20512345678', nombre: 'DISTRIBUIDORA HUAMAN PUNO S.A.C.', tipo: 'MAYORISTA' },
      })
    ).id;
  });

  const token = async (usuario = 'caja1') => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: ORIGEN },
      payload: { usuario, clave: CLAVE },
    });
    return r.json().accesoToken as string;
  };

  async function llega(parcial: Partial<Movimiento>): Promise<MovimientoVista> {
    const vista = await ingesta.registrar({
      id: `op-${++secuencia}`,
      cuentaId: 'bcp-pen-01',
      fechaHora: new Date(),
      tipo: 'ABONO',
      monto: 350,
      moneda: 'PEN',
      canal: 'YAPE',
      numeroOperacion: String(secuencia).padStart(8, '0'),
      ordenante: null,
      referencia: null,
      ...parcial,
    });
    await servicio.conciliarMovimiento(vista!.id);
    return vista!;
  }
  const ordenante = (nombre: string, extra: Partial<NonNullable<Movimiento['ordenante']>> = {}) => ({
    nombre,
    tipoDoc: null,
    numeroDoc: null,
    bancoOrigen: 'BCP',
    cuentaOrigen: null,
    ...extra,
  });
  const conciliacionDe = (movimientoId: string) =>
    db.conciliacion.findFirstOrThrow({ where: { movimientoId } });

  it('Yape exacto de un pedido creado en caja → CONCILIADO y el pedido queda pagado', async () => {
    const t = await token();
    const creado = await app.inject({
      method: 'POST',
      url: '/api/v1/pedidos',
      headers: { authorization: `Bearer ${t}` },
      payload: { monto: 350, tienda: 'Tienda Central', caja: 'Caja 1' },
    });
    expect(creado.statusCode).toBe(201);

    const actualizados: MovimientoVista[] = [];
    const dejar = bus.on('movimiento.actualizado', (m) => actualizados.push(m));
    const m = await llega({ monto: 350, ordenante: ordenante('JUAN C QUISPE M') });
    dejar();

    const c = await conciliacionDe(m.id);
    expect(c.estado).toBe('CONCILIADO');
    expect(c.pedidoId).toBe(creado.json().id);
    expect((await db.pedidoCaja.findUniqueOrThrow({ where: { id: c.pedidoId! } })).estado).toBe('PAGADO');
    expect(actualizados.at(-1)).toMatchObject({ id: m.id, estado: 'CONCILIADO' });
    expect(await db.auditoria.count({ where: { accion: 'CONCILIACION_AUTOMATICA' } })).toBe(1);
  });

  it('dos abonos para el mismo pedido: solo uno lo paga, el otro queda para revisión', async () => {
    await db.pedidoCaja.create({ data: { monto: '80.00', tienda: 'T', caja: 'Caja 1' } });
    const [a, b] = await Promise.all([llega({ monto: 80 }), llega({ monto: 80 })]);
    const estados = [(await conciliacionDe(a.id)).estado, (await conciliacionDe(b.id)).estado].sort();
    expect(estados[0]).toBe('CONCILIADO');
    expect(estados[1]).not.toBe('CONCILIADO');
  });

  it('pago parcial con referencia de factura → comprobante PARCIAL con saldo actualizado', async () => {
    const f = await db.comprobante.create({
      data: {
        tipo: 'FACTURA',
        serie: 'F001',
        numero: 2345,
        clienteId: distId,
        fechaEmision: new Date('2026-08-01'),
        fechaVencimiento: new Date('2026-08-31'),
        total: '6000.00',
        saldoPendiente: '6000.00',
        moneda: 'PEN',
      },
    });
    const m = await llega({
      monto: 2000,
      canal: 'TRANSFERENCIA',
      ordenante: ordenante('DISTRIB. H. PUNO'),
      referencia: 'PAGO A CTA F001-00002345',
    });
    expect((await conciliacionDe(m.id)).estado).toBe('CONCILIADO');
    const despues = await db.comprobante.findUniqueOrThrow({ where: { id: f.id } });
    expect(despues.estado).toBe('PARCIAL');
    expect(Number(despues.saldoPendiente)).toBe(4000);
  });

  it('pago de un familiar → PROBABLE; al confirmarlo se aprende el alias y la cuenta', async () => {
    const b = await db.comprobante.create({
      data: {
        tipo: 'BOLETA',
        serie: 'B001',
        numero: 5500,
        clienteId: juanId,
        fechaEmision: new Date(),
        fechaVencimiento: new Date(),
        total: '780.00',
        saldoPendiente: '780.00',
        moneda: 'PEN',
      },
    });
    const m = await llega({
      monto: 780,
      canal: 'TRANSFERENCIA',
      ordenante: ordenante('MARIA QUISPE MAMANI', { cuentaOrigen: '191-7654321-0-99' }),
    });
    const c = await conciliacionDe(m.id);
    expect(c.estado).toBe('PROBABLE');

    const t = await token();
    const confirmar = () =>
      app.inject({
        method: 'POST',
        url: `/api/v1/conciliaciones/${c.id}/confirmar`,
        headers: { authorization: `Bearer ${t}`, origin: ORIGEN },
        payload: { tipo: 'COMPROBANTE', destinoId: b.id },
      });
    expect((await confirmar()).statusCode).toBe(204);
    // Una segunda confirmación (doble clic, otra caja) no vuelve a aplicar el pago.
    expect((await confirmar()).statusCode).toBe(409);

    expect((await db.comprobante.findUniqueOrThrow({ where: { id: b.id } })).estado).toBe('PAGADO');
    const alias = await db.aliasCliente.findMany({ where: { clienteId: juanId } });
    expect(alias.map((a) => a.alias)).toEqual(['MARIA QUISPE MAMANI']);
    expect(await db.cuentaOrigenCliente.count({ where: { clienteId: juanId } })).toBe(1);

    const auditoria = await db.auditoria.findFirstOrThrow({ where: { accion: 'CONCILIACION_CONFIRMADA' } });
    expect(auditoria.usuarioId).toBeTruthy();
    expect(auditoria.datos).toMatchObject({ monto: 780, destino: { tipo: 'COMPROBANTE', id: b.id } });
    expect(await verificarCadena(db)).toMatchObject({ valida: true });

    // La próxima vez, el alias aprendido basta para conciliar solo.
    const b2 = await db.comprobante.create({
      data: {
        tipo: 'BOLETA',
        serie: 'B001',
        numero: 5501,
        clienteId: juanId,
        fechaEmision: new Date(),
        fechaVencimiento: new Date(),
        total: '120.00',
        saldoPendiente: '120.00',
        moneda: 'PEN',
      },
    });
    const m2 = await llega({ monto: 120, ordenante: ordenante('MARIA QUISPE MAMANI') });
    const c2 = await conciliacionDe(m2.id);
    expect(c2.estado).toBe('CONCILIADO');
    expect(c2.comprobanteId).toBe(b2.id);
  });

  it('dos pedidos del mismo monto → PROBABLE con ambos candidatos', async () => {
    await db.pedidoCaja.createMany({
      data: [
        { monto: '45.50', tienda: 'T', caja: 'Caja 1' },
        { monto: '45.50', tienda: 'T', caja: 'Caja 2' },
      ],
    });
    const m = await llega({ monto: 45.5 });
    const c = await conciliacionDe(m.id);
    expect(c.estado).toBe('PROBABLE');
    expect((c.candidatos as unknown[]).length).toBe(2);
    expect(await db.pedidoCaja.count({ where: { estado: 'ABIERTO' } })).toBe(2);
  });

  it('descartar un pago lo saca de la bandeja y queda auditado', async () => {
    const m = await llega({ monto: 12345.67 });
    const c = await conciliacionDe(m.id);
    expect(c.estado).toBe('SIN_IDENTIFICAR');
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/conciliaciones/${c.id}/descartar`,
      headers: { authorization: `Bearer ${await token()}` },
      payload: { motivo: 'Devolución de préstamo del socio' },
    });
    expect(r.statusCode).toBe(204);
    expect((await conciliacionDe(m.id)).estado).toBe('DESCARTADO');
    expect(await db.auditoria.count({ where: { accion: 'CONCILIACION_DESCARTADA' } })).toBe(1);
  });

  it('Ventas no puede confirmar ni descartar pagos', async () => {
    const m = await llega({ monto: 999 });
    const c = await conciliacionDe(m.id);
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/conciliaciones/${c.id}/descartar`,
      headers: { authorization: `Bearer ${await token('ventas1')}` },
      payload: { motivo: 'prueba' },
    });
    expect(r.statusCode).toBe(403);
  });

  it('la bandeja lista los probables con el movimiento y sus candidatos', async () => {
    await db.pedidoCaja.createMany({
      data: [
        { monto: '60.00', tienda: 'T', caja: 'Caja 1' },
        { monto: '60.00', tienda: 'T', caja: 'Caja 2' },
      ],
    });
    await llega({ monto: 60 });
    const r = await app.inject({
      url: '/api/v1/conciliaciones?estado=PROBABLE',
      headers: { authorization: `Bearer ${await token()}` },
    });
    const [item] = r.json();
    expect(item.movimiento.monto).toBe(60);
    expect(item.candidatos).toHaveLength(2);
  });

  it('conciliar dos veces el mismo movimiento no duplica la decisión', async () => {
    const m = await llega({ monto: 10 });
    expect(await servicio.conciliarMovimiento(m.id)).toBeNull();
    expect(await db.conciliacion.count({ where: { movimientoId: m.id } })).toBe(1);
  });
});
