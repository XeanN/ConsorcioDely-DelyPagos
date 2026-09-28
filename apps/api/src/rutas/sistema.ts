import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config.js';

const esquemaSalud = z.object({
  estado: z.literal('ok'),
  hora: z.string(),
});

const esquemaConfigPublica = z.object({
  modoDemo: z.boolean(),
  proveedorBancario: z.enum(['mock', 'bcp-rest', 'bcp-h2h']),
  sentryDsn: z.string().nullable(),
  entorno: z.string(),
});

/** Rutas públicas: no exponen datos de negocio. */
export const rutasSistema =
  (config: Config): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/salud',
      {
        schema: {
          tags: ['sistema'],
          summary: 'Estado de la API',
          response: { 200: esquemaSalud },
        },
      },
      async () => ({ estado: 'ok' as const, hora: new Date().toISOString() }),
    );

    app.get(
      '/configuracion-publica',
      {
        schema: {
          tags: ['sistema'],
          summary: 'Configuración que necesita la web al arrancar',
          response: { 200: esquemaConfigPublica },
        },
      },
      async () => ({
        modoDemo: config.BANK_PROVIDER === 'mock',
        proveedorBancario: config.BANK_PROVIDER,
        sentryDsn: config.SENTRY_DSN_WEB ?? null,
        entorno: config.SENTRY_ENTORNO,
      }),
    );
  };
