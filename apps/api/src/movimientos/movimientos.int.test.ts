import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { construirApp } from '../app.js';
import { cargarConfig } from '../config.js';
import { hashearClave } from '../auth/claves.js';
import { BusEventos } from '../eventos/bus.js';
import { MockBankProvider } from '../banco/mock/mock-bank-provider.js';
import type { Movimiento } from '../banco/tipos.js';
import { IngestaMovimientos } from './ingesta.js';
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

function movimiento(parcial: Partial<Movimiento> & { id: string }): Movimiento {
  return {
    cuentaId: 'bcp-pen-01',
    fechaHora: new Date(),
    tipo: 'ABONO',
    monto: 350,
    moneda: 'PEN',
    canal: 'YAPE',
    numeroOperacion: '12345678',
    ordenante: {
      nombre: 'JUAN C QUISPE M',
      tipoDoc: 'DNI',
      numeroDoc: '45678912',
      bancoOrigen: 'BCP',
      cuentaOrigen: '191-1234567-0-12',
    },
    referencia: 'pedido 12',
    ...parcial,
  };
}

describe.skipIf(!URL_PRUEBAS)('monitor de movimientos (integración)', () => {
  let db: BaseDatos;
  let bus: BusEventos;
  let app: Awaited<ReturnType<typeof construirApp>>;
  let ingesta: IngestaMovimientos;

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
        { usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA', hashClave },
        { usuario: 'finanzas1', nombre: 'Finanzas 1', rol: 'FINANZAS', hashClave },
      ],
    });
    ingesta = new IngestaMovimientos(db, new MockBankProvider({ semilla: 1, historialDias: 0 }), bus, silencioso);
    await ingesta.prepararCuentas();
  });

  const token = async (usuario: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'http://localhost:4200' },
      payload: { usuario, clave: CLAVE },
    });
    return r.json().accesoToken as string;
  };
  const listar = async (usuario: string, query = '') =>
    app.inject({
      url: `/api/v1/movimientos${query}`,
      headers: { authorization: `Bearer ${await token(usuario)}` },
    });

  describe('ingesta', () => {
    it('registra una sola vez aunque el banco reenvíe el movimiento', async () => {
      const publicados: string[] = [];
      const dejar = bus.on('movimiento.registrado', (m) => publicados.push(m.idBanco));
      expect(await ingesta.registrar(movimiento({ id: 'op-1' }))).not.toBeNull();
      expect(await ingesta.registrar(movimiento({ id: 'op-1' }))).toBeNull();
      dejar();
      expect(await db.movimiento.count()).toBe(1);
      expect(publicados).toEqual(['op-1']);
    });

    it('ignora cargos y cuentas desconocidas', async () => {
      expect(await ingesta.registrar(movimiento({ id: 'c1', tipo: 'CARGO' }))).toBeNull();
      expect(await ingesta.registrar(movimiento({ id: 'c2', cuentaId: 'otra-cuenta' }))).toBeNull();
      expect(await db.movimiento.count()).toBe(0);
    });

    it('recibe los abonos del simulador en vivo', async () => {
      const banco = new MockBankProvider({ semilla: 5, historialDias: 0, intervaloMinS: 1, intervaloMaxS: 1 });
      const viva = new IngestaMovimientos(db, banco, bus, silencioso);
      await viva.prepararCuentas();
      const llegada = new Promise((resolver) => {
        const dejar = bus.on('movimiento.registrado', (m) => {
          dejar();
          resolver(m);
        });
      });
      viva.iniciar();
      await llegada;
      viva.detener();
      banco.detener();
      expect(await db.movimiento.count()).toBeGreaterThanOrEqual(1);
    });
  });

  describe('listado y filtros', () => {
    beforeEach(async () => {
      await ingesta.registrar(movimiento({ id: 'm1', monto: 350, canal: 'YAPE' }));
      await ingesta.registrar(movimiento({ id: 'm2', monto: 1250.5, canal: 'TRANSFERENCIA', referencia: 'PAGO F001-2345' }));
      await ingesta.registrar(movimiento({ id: 'm3', monto: 350, canal: 'PLIN', cuentaId: 'ibk-pen-01' }));
      await ingesta.registrar(
        movimiento({ id: 'm4', monto: 99, fechaHora: new Date(Date.now() - 3 * 86_400_000) }),
      );
    });

    it('muestra solo los abonos de hoy, del más reciente al más antiguo', async () => {
      const { items } = (await listar('caja1')).json();
      expect(items.map((m: { idBanco: string }) => m.idBanco).sort()).toEqual(['m1', 'm2', 'm3']);
      expect(items.every((m: { estado: string }) => m.estado === 'POR_CONCILIAR')).toBe(true);
    });

    it('busca por monto exacto ("¿llegó el de 350?")', async () => {
      const { items } = (await listar('caja1', '?monto=350')).json();
      expect(items).toHaveLength(2);
      expect(items.every((m: { monto: number }) => m.monto === 350)).toBe(true);
    });

    it('filtra por canal, cuenta y texto', async () => {
      expect((await listar('caja1', '?canal=PLIN')).json().items).toHaveLength(1);
      expect((await listar('caja1', '?cuentaId=ibk-pen-01')).json().items).toHaveLength(1);
      expect((await listar('caja1', '?q=f001-2345')).json().items[0].idBanco).toBe('m2');
    });

    it('consulta días anteriores', async () => {
      const hace3 = new Date(Date.now() - 3 * 86_400_000 - 5 * 3_600_000).toISOString().slice(0, 10);
      const { items } = (await listar('caja1', `?fecha=${hace3}`)).json();
      expect(items.map((m: { idBanco: string }) => m.idBanco)).toContain('m4');
    });

    it('enmascara documento y cuenta para Caja, no para Finanzas', async () => {
      const deCaja = (await listar('caja1', '?canal=YAPE')).json().items[0];
      const deFinanzas = (await listar('finanzas1', '?canal=YAPE')).json().items[0];
      expect(deCaja.ordenanteNumeroDoc).toBe('****8912');
      expect(deFinanzas.ordenanteNumeroDoc).toBe('45678912');
    });

    it('rechaza filtros inválidos (inyección, formatos)', async () => {
      expect((await listar('caja1', "?canal=YAPE';DROP TABLE movimientos;--")).statusCode).toBe(400);
      expect((await listar('caja1', '?fecha=ayer')).statusCode).toBe(400);
      expect((await listar('caja1', '?limite=5000')).statusCode).toBe(400);
      expect(await db.movimiento.count()).toBe(4);
    });

    it('pagina con cursor', async () => {
      const primera = (await listar('caja1', '?limite=2')).json();
      expect(primera.items).toHaveLength(2);
      expect(primera.siguienteCursor).toBeTruthy();
      const segunda = (
        await listar('caja1', `?limite=2&antesDe=${encodeURIComponent(primera.siguienteCursor)}`)
      ).json();
      expect(segunda.items).toHaveLength(1);
    });

    it('calcula los totales del día por canal', async () => {
      const r = await app.inject({
        url: '/api/v1/movimientos/resumen',
        headers: { authorization: `Bearer ${await token('caja1')}` },
      });
      const { porCanal, totales } = r.json();
      expect(totales).toEqual([{ moneda: 'PEN', cantidad: 3, total: 1950.5 }]);
      expect(porCanal).toContainEqual({ canal: 'YAPE', moneda: 'PEN', cantidad: 1, total: 350 });
    });

    it('lista las cuentas de Dely', async () => {
      const r = await app.inject({
        url: '/api/v1/cuentas',
        headers: { authorization: `Bearer ${await token('caja1')}` },
      });
      expect(r.json().map((c: { id: string }) => c.id).sort()).toEqual(['bcp-pen-01', 'bcp-usd-01', 'ibk-pen-01']);
    });

    it('exige sesión', async () => {
      expect((await app.inject({ url: '/api/v1/movimientos' })).statusCode).toBe(401);
    });
  });

  describe('en vivo (SSE)', () => {
    it('envía cada abono nuevo a la pantalla conectada', async () => {
      await app.listen({ port: 0, host: '127.0.0.1' });
      const { port } = app.server.address() as AddressInfo;
      const controlador = new AbortController();
      const respuesta = await fetch(`http://127.0.0.1:${port}/api/v1/movimientos/en-vivo`, {
        headers: { authorization: `Bearer ${await token('caja1')}` },
        signal: controlador.signal,
      });
      expect(respuesta.status).toBe(200);
      expect(respuesta.headers.get('content-type')).toContain('text/event-stream');

      const lector = respuesta.body!.getReader();
      const decodificador = new TextDecoder();
      let texto = '';
      const leerHasta = async (patron: string) => {
        while (!texto.includes(patron)) {
          const { value, done } = await lector.read();
          if (done) break;
          texto += decodificador.decode(value);
        }
      };

      await leerHasta('event: conectado');
      await ingesta.registrar(movimiento({ id: 'vivo-1', monto: 777 }));
      await leerHasta('vivo-1');
      controlador.abort();

      const bloque = texto.split('\n\n').find((b) => b.includes('event: movimiento'))!;
      const datos = JSON.parse(bloque.split('data: ')[1]!);
      expect(datos).toMatchObject({ idBanco: 'vivo-1', monto: 777, ordenanteNumeroDoc: '****8912' });
    });

    it('exige sesión para conectarse', async () => {
      const r = await app.inject({ url: '/api/v1/movimientos/en-vivo' });
      expect(r.statusCode).toBe(401);
    });
  });
});
