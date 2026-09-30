import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../app.js';
import { cargarConfig, configMotor } from '../config.js';
import { hashearClave } from '../auth/claves.js';
import { BusEventos } from '../eventos/bus.js';
import { MockBankProvider } from '../banco/mock/mock-bank-provider.js';
import { IngestaMovimientos } from '../movimientos/ingesta.js';
import { ServicioConciliacion } from '../conciliacion/servicio-conciliacion.js';
import { URL_PRUEBAS, crearBaseDatosPruebas, limpiarBaseDatos } from '../test/bd-pruebas.js';
import type { BaseDatos } from '../db/prisma.js';

const CONFIG = cargarConfig({
  NODE_ENV: 'test',
  JWT_SECRETO: 'secreto-de-pruebas-con-mas-de-32-caracteres',
  LOGIN_LIMITE_POR_MINUTO: '1000',
  RATE_LIMIT_MAX: '1000',
});
const CLAVE = 'ClavePrueba-X1';
const silencioso = { info: () => {}, warn: () => {}, error: () => {} };

describe.skipIf(!URL_PRUEBAS)('integración con sistemas externos (OAuth2)', () => {
  let db: BaseDatos;
  let app: Awaited<ReturnType<typeof construirApp>>;
  let bus: BusEventos;

  beforeAll(async () => {
    db = crearBaseDatosPruebas();
    bus = new BusEventos();
    app = await construirApp(CONFIG, { db, bus });
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
        { usuario: 'admin1', nombre: 'Admin', rol: 'ADMIN', hashClave },
        { usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA', hashClave },
      ],
    });
    await db.cliente.create({
      data: { tipoDoc: 'RUC', numeroDoc: '20100070970', nombre: 'COMERCIAL QUISPE S.A.C.', tipo: 'MAYORISTA' },
    });
  });

  const tokenPersona = async (usuario: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { origin: 'http://localhost:4200' },
        payload: { usuario, clave: CLAVE },
      })
    ).json().accesoToken as string;

  async function crearIntegracion(alcances: string[]) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/integraciones',
      headers: { authorization: `Bearer ${await tokenPersona('admin1')}` },
      payload: { nombre: 'ERP Dely', alcances },
    });
    expect(r.statusCode).toBe(201);
    const { integracion, clientSecret } = r.json();
    return { id: integracion.id as string, clientId: integracion.clientId as string, clientSecret: clientSecret as string };
  }

  const pedirToken = (clientId: string, clientSecret: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/oauth/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    });

  async function tokenSistema(alcances: string[]) {
    const c = await crearIntegracion(alcances);
    return (await pedirToken(c.clientId, c.clientSecret)).json().access_token as string;
  }

  describe('credenciales y token', () => {
    it('el secreto se muestra una sola vez y solo se guarda su hash', async () => {
      const c = await crearIntegracion(['pedidos']);
      expect(c.clientSecret).toMatch(/^dely_sec_/);
      const lista = await app.inject({
        url: '/api/v1/integraciones',
        headers: { authorization: `Bearer ${await tokenPersona('admin1')}` },
      });
      expect(lista.body).not.toContain(c.clientSecret);
      expect(lista.body).not.toContain('hashSecreto');
      const guardado = await db.clienteIntegracion.findUniqueOrThrow({ where: { id: c.id } });
      expect(guardado.hashSecreto).not.toContain(c.clientSecret);
    });

    it('emite un token con el formulario estándar, con JSON y con cabecera Basic', async () => {
      const c = await crearIntegracion(['pedidos', 'movimientos:leer']);
      const formulario = await pedirToken(c.clientId, c.clientSecret);
      expect(formulario.statusCode).toBe(200);
      expect(formulario.json()).toMatchObject({ token_type: 'Bearer', scope: 'pedidos movimientos:leer' });
      expect(formulario.headers['cache-control']).toBe('no-store');

      const json = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: { grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret },
      });
      expect(json.statusCode).toBe(200);

      const basic = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        headers: { authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}` },
        payload: { grant_type: 'client_credentials' },
      });
      expect(basic.statusCode).toBe(200);
    });

    it('rechaza secretos incorrectos, otros grant_type e integraciones revocadas', async () => {
      const c = await crearIntegracion(['pedidos']);
      const malo = await pedirToken(c.clientId, 'dely_sec_incorrecto');
      expect(malo.statusCode).toBe(401);
      expect(malo.json().error).toBe('invalid_client');

      const password = await app.inject({
        method: 'POST',
        url: '/api/v1/oauth/token',
        payload: { grant_type: 'password', client_id: c.clientId, client_secret: c.clientSecret },
      });
      expect(password.json().error).toBe('unsupported_grant_type');

      await app.inject({
        method: 'POST',
        url: `/api/v1/integraciones/${c.id}/revocar`,
        headers: { authorization: `Bearer ${await tokenPersona('admin1')}` },
      });
      expect((await pedirToken(c.clientId, c.clientSecret)).statusCode).toBe(401);
      expect(await db.auditoria.count({ where: { accion: 'INTEGRACION_TOKEN_RECHAZADO' } })).toBe(2);
    });

    it('al regenerar el secreto, el anterior deja de servir', async () => {
      const c = await crearIntegracion(['pedidos']);
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/integraciones/${c.id}/regenerar-secreto`,
        headers: { authorization: `Bearer ${await tokenPersona('admin1')}` },
      });
      const nuevo = r.json().clientSecret as string;
      expect((await pedirToken(c.clientId, c.clientSecret)).statusCode).toBe(401);
      expect((await pedirToken(c.clientId, nuevo)).statusCode).toBe(200);
    });

    it('solo el admin gestiona integraciones', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/integraciones',
        headers: { authorization: `Bearer ${await tokenPersona('caja1')}` },
        payload: { nombre: 'Intruso', alcances: ['pedidos'] },
      });
      expect(r.statusCode).toBe(403);
    });
  });

  describe('permisos mínimos del sistema', () => {
    it('un sistema no puede entrar a pantallas de personas ni confirmar pagos', async () => {
      const t = await tokenSistema(['pedidos', 'comprobantes', 'movimientos:leer']);
      for (const url of ['/api/v1/usuarios/', '/api/v1/integraciones', '/api/v1/conciliaciones?estado=PROBABLE']) {
        expect((await app.inject({ url, headers: { authorization: `Bearer ${t}` } })).statusCode).toBe(403);
      }
    });

    it('sin el alcance, no accede aunque tenga otro', async () => {
      const t = await tokenSistema(['pedidos']);
      const r = await app.inject({ url: '/api/v1/movimientos', headers: { authorization: `Bearer ${t}` } });
      expect(r.statusCode).toBe(403);
      expect(r.json().error).toContain('movimientos:leer');
    });
  });

  describe('pedidos desde el ERP', () => {
    it('crea el pedido una sola vez aunque el ERP lo reenvíe, y lo concilia cuando llega el pago', async () => {
      const t = await tokenSistema(['pedidos']);
      const enviar = () =>
        app.inject({
          method: 'POST',
          url: '/api/v1/pedidos',
          headers: { authorization: `Bearer ${t}` },
          payload: {
            monto: 1250.5,
            tienda: 'Tienda Central',
            caja: 'Caja 3',
            idExterno: 'ERP-PED-000123',
            clienteDocumento: { tipoDoc: 'RUC', numeroDoc: '20100070970' },
          },
        });
      const primero = await enviar();
      const reenvio = await enviar();
      expect(primero.statusCode).toBe(201);
      expect(reenvio.statusCode).toBe(200);
      expect(reenvio.json()).toEqual({ id: primero.json().id, duplicado: true });
      expect(await db.pedidoCaja.count()).toBe(1);

      const auditoria = await db.auditoria.findFirstOrThrow({ where: { accion: 'PEDIDO_CREADO' } });
      expect(auditoria.usuarioId).toBeNull();
      expect(auditoria.datos).toMatchObject({ integracion: 'ERP Dely' });

      // Llega el abono y el pedido del ERP queda pagado.
      const ingesta = new IngestaMovimientos(db, new MockBankProvider({ semilla: 1, historialDias: 0 }), bus, silencioso);
      await ingesta.prepararCuentas();
      const m = await ingesta.registrar({
        id: 'op-erp-1',
        cuentaId: 'bcp-pen-01',
        fechaHora: new Date(),
        tipo: 'ABONO',
        monto: 1250.5,
        moneda: 'PEN',
        canal: 'TRANSFERENCIA',
        numeroOperacion: '555',
        ordenante: { nombre: 'COMERCIAL QUISPE', tipoDoc: 'RUC', numeroDoc: '20100070970', bancoOrigen: 'BCP', cuentaOrigen: null },
        referencia: null,
      });
      await new ServicioConciliacion(db, bus, configMotor(CONFIG), silencioso).conciliarMovimiento(m!.id);
      expect((await db.pedidoCaja.findFirstOrThrow()).estado).toBe('PAGADO');
    });

    it('rechaza un cliente que no existe', async () => {
      const t = await tokenSistema(['pedidos']);
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/pedidos',
        headers: { authorization: `Bearer ${t}` },
        payload: { monto: 10, tienda: 'T', caja: 'C', clienteDocumento: { tipoDoc: 'DNI', numeroDoc: '99999999' } },
      });
      expect(r.statusCode).toBe(400);
    });
  });

  describe('comprobantes desde el ERP', () => {
    const lote = (saldo = 3000) => ({
      comprobantes: [
        {
          tipo: 'FACTURA',
          serie: 'F001',
          numero: 9001,
          fechaEmision: '2026-09-01',
          fechaVencimiento: '2026-10-01',
          total: 3000,
          saldoPendiente: saldo,
          moneda: 'PEN',
          cliente: { tipoDoc: 'RUC', numeroDoc: '20100070970', nombre: 'COMERCIAL QUISPE S.A.C.' },
        },
      ],
    });

    it('crea, y al reenviar el mismo lote no duplica nada', async () => {
      const t = await tokenSistema(['comprobantes']);
      const enviar = (cuerpo = lote()) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/integracion/comprobantes',
          headers: { authorization: `Bearer ${t}` },
          payload: cuerpo,
        });
      expect((await enviar()).json()).toMatchObject({ creados: 1, actualizados: 0, sinCambios: 0 });
      expect((await enviar()).json()).toMatchObject({ creados: 0, actualizados: 0, sinCambios: 1 });
      expect((await enviar(lote(1000))).json()).toMatchObject({ actualizados: 1 });
      expect((await db.comprobante.findFirstOrThrow()).estado).toBe('PARCIAL');
    });

    it('no pisa el saldo de un comprobante ya cobrado en Dely Pagos', async () => {
      const t = await tokenSistema(['comprobantes']);
      await app.inject({
        method: 'POST',
        url: '/api/v1/integracion/comprobantes',
        headers: { authorization: `Bearer ${t}` },
        payload: lote(),
      });
      const f = await db.comprobante.findFirstOrThrow();
      const mov = await db.movimiento.create({
        data: {
          proveedor: 'mock',
          idBanco: 'x1',
          cuenta: { create: { id: 'c1', banco: 'BCP', numero: '1', cci: '00200000000000000001', moneda: 'PEN', tipo: 'CORRIENTE' } },
          fechaHora: new Date(),
          tipo: 'ABONO',
          monto: '500.00',
          moneda: 'PEN',
          canal: 'TRANSFERENCIA',
          numeroOperacion: '1',
        },
      });
      await db.conciliacion.create({
        data: { movimientoId: mov.id, comprobanteId: f.id, puntaje: '0.950', estado: 'CONCILIADO', motivos: [], montoAplicado: '500.00' },
      });
      await db.comprobante.update({ where: { id: f.id }, data: { saldoPendiente: '2500.00', estado: 'PARCIAL' } });

      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/integracion/comprobantes',
        headers: { authorization: `Bearer ${t}` },
        payload: lote(3000),
      });
      expect(r.json().conservados).toEqual(['F001-9001']);
      expect(Number((await db.comprobante.findFirstOrThrow()).saldoPendiente)).toBe(2500);
    });

    it('valida el RUC y el formato de la serie', async () => {
      const t = await tokenSistema(['comprobantes']);
      const invalido = lote();
      invalido.comprobantes[0]!.cliente.numeroDoc = '20100070971';
      const r = await app.inject({
        method: 'POST',
        url: '/api/v1/integracion/comprobantes',
        headers: { authorization: `Bearer ${t}` },
        payload: invalido,
      });
      expect(r.statusCode).toBe(400);
    });
  });
});
