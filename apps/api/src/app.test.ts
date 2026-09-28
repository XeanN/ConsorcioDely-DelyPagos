import { describe, expect, it } from 'vitest';
import { cargarConfig } from './config.js';
import { construirApp } from './app.js';

describe('configuración', () => {
  it('usa el proveedor mock por defecto', () => {
    const config = cargarConfig({});
    expect(config.BANK_PROVIDER).toBe('mock');
    expect(config.API_PORT).toBe(4000);
  });

  it('rechaza un proveedor bancario desconocido', () => {
    expect(() => cargarConfig({ BANK_PROVIDER: 'banco-x' })).toThrow(/BANK_PROVIDER/);
  });
});

describe('GET /api/salud', () => {
  it('indica modo demostración cuando el proveedor es mock', async () => {
    const app = await construirApp(cargarConfig({ NODE_ENV: 'test', BANK_PROVIDER: 'mock' }));
    const respuesta = await app.inject({ method: 'GET', url: '/api/salud' });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json()).toMatchObject({ estado: 'ok', modoDemo: true });
    await app.close();
  });

  it('no indica modo demostración con un proveedor real', async () => {
    const app = await construirApp(cargarConfig({ NODE_ENV: 'test', BANK_PROVIDER: 'bcp-rest' }));
    const respuesta = await app.inject({ method: 'GET', url: '/api/salud' });
    expect(respuesta.json()).toMatchObject({ modoDemo: false, proveedorBancario: 'bcp-rest' });
    await app.close();
  });
});
