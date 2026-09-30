import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BaseDatos } from '../db/prisma.js';
import { crearAutenticador, exigirAcceso, exigirRol } from '../auth/plugin-auth.js';
import {
  ALCANCES,
  ErrorIntegracion,
  ServicioIntegraciones,
  type Alcance,
} from '../integracion/servicio-integraciones.js';
import { sincronizarComprobantes } from '../integracion/sincronizar-comprobantes.js';
import { esRucValido } from '../simulacion/documentos.js';

const alcance = z.enum(Object.keys(ALCANCES) as [Alcance, ...Alcance[]]);
const esquemaIntegracion = z.object({
  id: z.string(),
  nombre: z.string(),
  clientId: z.string(),
  alcances: z.array(z.string()),
  activo: z.boolean(),
  ultimoUsoEn: z.date().nullable(),
  creadoEn: z.date(),
});
const esquemaError = z.object({ error: z.string() });
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');

const esquemaComprobanteErp = z
  .object({
    tipo: z.enum(['FACTURA', 'BOLETA']),
    serie: z.string().regex(/^[FB]\d{3}$/, 'Serie como F001 o B001'),
    numero: z.number().int().positive().max(99_999_999),
    fechaEmision: fechaDia,
    fechaVencimiento: fechaDia,
    total: z.number().positive().max(100_000_000).multipleOf(0.01),
    saldoPendiente: z.number().min(0).max(100_000_000).multipleOf(0.01).optional(),
    moneda: z.enum(['PEN', 'USD']),
    cliente: z.object({
      tipoDoc: z.enum(['DNI', 'RUC', 'CE']),
      numeroDoc: z.string().regex(/^\d{8,12}$/),
      nombre: z.string().trim().min(2).max(200),
      tipo: z.enum(['MAYORISTA', 'MINORISTA', 'CONSUMIDOR_FINAL']).optional(),
    }),
  })
  .refine((c) => c.cliente.tipoDoc !== 'RUC' || esRucValido(c.cliente.numeroDoc), {
    message: 'RUC inválido (dígito verificador)',
    path: ['cliente', 'numeroDoc'],
  })
  .refine((c) => c.cliente.tipoDoc !== 'DNI' || /^\d{8}$/.test(c.cliente.numeroDoc), {
    message: 'DNI de 8 dígitos',
    path: ['cliente', 'numeroDoc'],
  });

/** Lee client_id/client_secret de la cabecera Basic (RFC 6749 §2.3.1). */
function credencialesBasic(cabecera: string | undefined): { id: string; secreto: string } | null {
  if (!cabecera?.startsWith('Basic ')) return null;
  const texto = Buffer.from(cabecera.slice(6), 'base64').toString('utf8');
  const separador = texto.indexOf(':');
  if (separador <= 0) return null;
  return {
    id: decodeURIComponent(texto.slice(0, separador)),
    secreto: decodeURIComponent(texto.slice(separador + 1)),
  };
}

function responderError(reply: FastifyReply, error: unknown) {
  if (error instanceof ErrorIntegracion) return reply.status(error.estado).send({ error: error.message });
  throw error;
}

export const rutasIntegraciones =
  (db: BaseDatos, secreto: string, minutosToken: number): FastifyPluginAsyncZod =>
  async (app) => {
    const servicio = new ServicioIntegraciones(db, secreto, minutosToken);
    const autenticar = crearAutenticador(secreto);

    // ─── OAuth2 client credentials ────────────────────────

    app.post(
      '/oauth/token',
      {
        config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
        schema: {
          tags: ['integración'],
          summary: 'Obtener un token para un sistema externo (OAuth2 client credentials)',
          description:
            'Enviar grant_type=client_credentials con client_id y client_secret en el cuerpo ' +
            '(application/x-www-form-urlencoded o JSON) o en la cabecera Authorization: Basic.',
          body: z.object({
            grant_type: z.string().max(40),
            client_id: z.string().max(60).optional(),
            client_secret: z.string().max(200).optional(),
            scope: z.string().max(200).optional(),
          }),
          response: {
            200: z.object({
              access_token: z.string(),
              token_type: z.literal('Bearer'),
              expires_in: z.number(),
              scope: z.string(),
            }),
            400: z.object({ error: z.string(), error_description: z.string() }),
            401: z.object({ error: z.string(), error_description: z.string() }),
          },
        },
      },
      async (request, reply) => {
        // Las respuestas con tokens nunca se guardan en cachés (RFC 6749 §5.1).
        reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
        if (request.body.grant_type !== 'client_credentials') {
          return reply.status(400).send({
            error: 'unsupported_grant_type',
            error_description: 'Solo se admite grant_type=client_credentials.',
          });
        }
        const basic = credencialesBasic(request.headers.authorization);
        const clientId = basic?.id ?? request.body.client_id;
        const clientSecret = basic?.secreto ?? request.body.client_secret;
        if (!clientId || !clientSecret) {
          return reply.status(400).send({
            error: 'invalid_request',
            error_description: 'Faltan client_id y client_secret.',
          });
        }
        const emitido = await servicio.emitirToken(clientId, clientSecret, request.ip ?? null);
        if (!emitido) {
          return reply
            .status(401)
            .header('WWW-Authenticate', 'Basic realm="dely-pagos"')
            .send({ error: 'invalid_client', error_description: 'Credenciales no válidas o revocadas.' });
        }
        return {
          access_token: emitido.token,
          token_type: 'Bearer' as const,
          expires_in: Math.round((emitido.expiraEn.getTime() - Date.now()) / 1000),
          scope: emitido.alcances.join(' '),
        };
      },
    );

    // ─── Administración (solo ADMIN) ──────────────────────

    const soloAdmin = { preHandler: [autenticar, exigirRol('ADMIN')] };
    const comun = { tags: ['integración'], security: [{ bearer: [] }] };

    app.get(
      '/integraciones',
      {
        ...soloAdmin,
        schema: {
          ...comun,
          summary: 'Sistemas externos con acceso a la API',
          response: {
            200: z.object({
              integraciones: z.array(esquemaIntegracion),
              alcancesDisponibles: z.record(z.string(), z.string()),
            }),
          },
        },
      },
      async () => ({ integraciones: await servicio.listar(), alcancesDisponibles: { ...ALCANCES } }),
    );

    app.post(
      '/integraciones',
      {
        ...soloAdmin,
        schema: {
          ...comun,
          summary: 'Crear credenciales (el secreto se muestra una sola vez)',
          body: z.object({
            nombre: z.string().trim().min(3).max(80),
            alcances: z.array(alcance).min(1).max(3),
          }),
          response: { 201: z.object({ integracion: esquemaIntegracion, clientSecret: z.string() }) },
        },
      },
      async (request, reply) => {
        const creado = await servicio.crear(
          request.body.nombre,
          [...new Set(request.body.alcances)],
          request.usuarioSesion!,
        );
        return reply.status(201).send(creado);
      },
    );

    app.post(
      '/integraciones/:id/:accion',
      {
        ...soloAdmin,
        schema: {
          ...comun,
          summary: 'Revocar, activar o regenerar el secreto de una integración',
          params: z.object({ id: z.uuid(), accion: z.enum(['revocar', 'activar', 'regenerar-secreto']) }),
          response: {
            200: z.union([esquemaIntegracion, z.object({ clientId: z.string(), clientSecret: z.string() })]),
            404: esquemaError,
          },
        },
      },
      async (request, reply) => {
        const { id, accion } = request.params;
        try {
          if (accion === 'regenerar-secreto') return await servicio.regenerarSecreto(id, request.usuarioSesion!);
          return await servicio.cambiarEstado(id, accion === 'activar', request.usuarioSesion!);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    // ─── Datos que envía el ERP ───────────────────────────

    app.post(
      '/integracion/comprobantes',
      {
        preHandler: [autenticar, exigirAcceso(['FINANZAS'], 'comprobantes')],
        schema: {
          ...comun,
          summary: 'Enviar facturas y boletas emitidas (idempotente, hasta 500 por lote)',
          body: z.object({ comprobantes: z.array(esquemaComprobanteErp).min(1).max(500) }),
          response: {
            200: z.object({
              creados: z.number(),
              actualizados: z.number(),
              sinCambios: z.number(),
              conservados: z.array(z.string()),
            }),
          },
        },
      },
      async (request) => sincronizarComprobantes(db, request.body.comprobantes, request.usuarioSesion!),
    );
  };
