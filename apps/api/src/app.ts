import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { Config } from './config.js';

export async function construirApp(config: Config) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  await app.register(cors, { origin: config.WEB_ORIGIN });

  app.get('/api/salud', async () => ({
    estado: 'ok',
    proveedorBancario: config.BANK_PROVIDER,
    modoDemo: config.BANK_PROVIDER === 'mock',
    hora: new Date().toISOString(),
  }));

  return app;
}
