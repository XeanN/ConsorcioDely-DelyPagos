import { afterEach, describe, expect, it } from 'vitest';
import { cargarConfig, type Config } from './config.js';
import { construirApp } from './app.js';

type App = Awaited<ReturnType<typeof construirApp>>;
let app: App | undefined;

async function crearApp(entorno: Record<string, string> = {}) {
  app = await construirApp(cargarConfig({ NODE_ENV: 'test', ...entorno }));
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('configuración', () => {
  it('usa valores seguros por defecto', () => {
    const config: Config = cargarConfig({});
    expect(config.BANK_PROVIDER).toBe('mock');
    expect(config.CORS_ORIGENES).toEqual(['http://localhost:4200']);
    expect(config.CONFIAR_PROXY).toBe(false);
  });

  it('rechaza un proveedor bancario desconocido', () => {
    expect(() => cargarConfig({ BANK_PROVIDER: 'banco-x' })).toThrow(/BANK_PROVIDER/);
  });

  it('rechaza CORS abierto a cualquier origen', () => {
    expect(() => cargarConfig({ CORS_ORIGENES: '*' })).toThrow(/CORS_ORIGENES/);
  });

  it('acepta varios orígenes separados por comas', () => {
    const config = cargarConfig({ CORS_ORIGENES: 'https://caja.dely.pe, https://erp.dely.pe' });
    expect(config.CORS_ORIGENES).toEqual(['https://caja.dely.pe', 'https://erp.dely.pe']);
  });
});

describe('rutas del sistema', () => {
  it('GET /api/v1/salud responde ok', async () => {
    const respuesta = await (await crearApp()).inject({ url: '/api/v1/salud' });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ estado: 'ok' });
  });

  it('indica modo demostración cuando el proveedor es mock', async () => {
    const respuesta = await (await crearApp()).inject({ url: '/api/v1/configuracion-publica' });
    expect(respuesta.json()).toMatchObject({ modoDemo: true, proveedorBancario: 'mock' });
  });

  it('no indica modo demostración con un proveedor real', async () => {
    const respuesta = await (
      await crearApp({ BANK_PROVIDER: 'bcp-rest' })
    ).inject({ url: '/api/v1/configuracion-publica' });
    expect(respuesta.json()).toMatchObject({ modoDemo: false, proveedorBancario: 'bcp-rest' });
  });

  it('publica el contrato OpenAPI', async () => {
    const respuesta = await (await crearApp()).inject({ url: '/api/docs/json' });
    expect(respuesta.statusCode).toBe(200);
    expect(Object.keys(respuesta.json().paths)).toContain('/api/v1/salud');
  });

  it('no expone la documentación si está deshabilitada', async () => {
    const respuesta = await (
      await crearApp({ DOCS_HABILITADOS: 'false' })
    ).inject({ url: '/api/docs/json' });
    expect(respuesta.statusCode).toBe(404);
  });
});

describe('cabeceras de seguridad', () => {
  it('envía CSP, HSTS, nosniff y bloqueo de iframes', async () => {
    const { headers } = await (await crearApp()).inject({ url: '/api/v1/salud' });
    expect(headers['content-security-policy']).toContain("default-src 'none'");
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['strict-transport-security']).toContain('max-age=31536000');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });
});

describe('CORS con lista blanca', () => {
  it('permite un origen autorizado', async () => {
    const { headers } = await (
      await crearApp({ CORS_ORIGENES: 'https://caja.dely.pe' })
    ).inject({ url: '/api/v1/salud', headers: { origin: 'https://caja.dely.pe' } });
    expect(headers['access-control-allow-origin']).toBe('https://caja.dely.pe');
  });

  it('no autoriza un origen desconocido', async () => {
    const { headers } = await (
      await crearApp({ CORS_ORIGENES: 'https://caja.dely.pe' })
    ).inject({ url: '/api/v1/salud', headers: { origin: 'https://atacante.example' } });
    expect(headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('límite de peticiones', () => {
  it('responde 429 al superar el máximo', async () => {
    const instancia = await crearApp({ RATE_LIMIT_MAX: '2' });
    await instancia.inject({ url: '/api/v1/salud' });
    await instancia.inject({ url: '/api/v1/salud' });
    const respuesta = await instancia.inject({ url: '/api/v1/salud' });
    expect(respuesta.statusCode).toBe(429);
  });
});

describe('manejo de errores', () => {
  it('responde 404 genérico en rutas inexistentes', async () => {
    const respuesta = await (await crearApp()).inject({ url: '/api/v1/no-existe' });
    expect(respuesta.statusCode).toBe(404);
    expect(respuesta.json()).toEqual({ error: 'No encontrado' });
  });

  it('no filtra detalles internos en errores 500', async () => {
    const instancia = await crearApp();
    instancia.get('/api/v1/prueba-error', async () => {
      throw new Error('fallo en SELECT * FROM clientes WHERE ruc=20123456789');
    });
    const respuesta = await instancia.inject({ url: '/api/v1/prueba-error' });
    expect(respuesta.statusCode).toBe(500);
    expect(respuesta.json()).toEqual({ error: 'Error interno del servidor' });
    expect(respuesta.body).not.toContain('SELECT');
  });
});
