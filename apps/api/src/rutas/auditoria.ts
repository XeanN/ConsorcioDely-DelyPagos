import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BaseDatos } from '../db/prisma.js';
import { verificarCadena } from '../auditoria/auditoria.js';
import { crearAutenticador, exigirRol } from '../auth/plugin-auth.js';

export const rutasAuditoria =
  (db: BaseDatos, secreto: string): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', crearAutenticador(secreto));
    app.addHook('preHandler', exigirRol('FINANZAS'));

    app.get(
      '/verificacion',
      {
        schema: {
          tags: ['auditoría'],
          summary: 'Verifica que ningún registro de auditoría haya sido alterado',
          security: [{ bearer: [] }],
          response: {
            200: z.object({
              valida: z.boolean(),
              registros: z.number(),
              primerIdAlterado: z.string().nullable(),
            }),
          },
        },
      },
      async () => verificarCadena(db),
    );
  };
