import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { Config } from '../config.js';
import type { BaseDatos } from '../db/prisma.js';
import { crearAutenticador, origenPermitido } from '../auth/plugin-auth.js';
import { ServicioAuth, type SesionEmitida } from '../auth/servicio-auth.js';

export const COOKIE_SESION = 'dely_sesion';
const RUTA_COOKIE = '/api/v1/auth';

const esquemaUsuario = z.object({
  id: z.string(),
  usuario: z.string(),
  nombre: z.string(),
  rol: z.enum(['VENTAS', 'CAJA', 'FINANZAS', 'ADMIN', 'INTEGRACION']),
  debeCambiarClave: z.boolean(),
});

const esquemaSesion = z.object({
  usuario: esquemaUsuario,
  accesoToken: z.string(),
  accesoExpiraEn: z.string(),
});

const esquemaError = z.object({
  error: z.string(),
  codigo: z.string().optional(),
  problemas: z.array(z.string()).optional(),
});

export const rutasAuth =
  (db: BaseDatos, config: Config & { JWT_SECRETO: string }): FastifyPluginAsyncZod =>
  async (app) => {
    const servicio = new ServicioAuth(db, config);
    const autenticarConClavePendiente = crearAutenticador(config.JWT_SECRETO, {
      permitirClavePendiente: true,
    });

    const contexto = (request: FastifyRequest) => ({
      ip: request.ip ?? null,
      agenteUsuario: request.headers['user-agent'] ?? null,
    });

    const responderSesion = (reply: FastifyReply, sesion: SesionEmitida) => {
      reply.setCookie(COOKIE_SESION, sesion.refrescoToken, {
        path: RUTA_COOKIE,
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        expires: sesion.refrescoExpiraEn,
      });
      return {
        usuario: sesion.usuario,
        accesoToken: sesion.accesoToken,
        accesoExpiraEn: sesion.accesoExpiraEn.toISOString(),
      };
    };

    const limpiarCookie = (reply: FastifyReply) =>
      reply.clearCookie(COOKIE_SESION, { path: RUTA_COOKIE, httpOnly: true, secure: true, sameSite: 'strict' });

    app.post(
      '/login',
      {
        // Límite estricto contra fuerza bruta, además del bloqueo por usuario.
        config: { rateLimit: { max: config.LOGIN_LIMITE_POR_MINUTO, timeWindow: '1 minute' } },
        schema: {
          tags: ['autenticación'],
          summary: 'Iniciar sesión',
          body: z.object({
            usuario: z.string().trim().min(1).max(40),
            clave: z.string().min(1).max(200),
          }),
          response: { 200: esquemaSesion, 401: esquemaError, 403: esquemaError, 423: esquemaError },
        },
      },
      async (request, reply) => {
        if (!origenPermitido(request, config.CORS_ORIGENES)) {
          return reply.status(403).send({ error: 'Origen no permitido' });
        }
        const resultado = await servicio.iniciarSesion(
          request.body.usuario,
          request.body.clave,
          contexto(request),
        );
        if (resultado.ok) return responderSesion(reply, resultado.sesion);
        if (resultado.motivo === 'BLOQUEADO') {
          return reply.status(423).send({
            error: `Cuenta bloqueada por intentos fallidos. Intente en ${resultado.minutosRestantes} min.`,
          });
        }
        // Mensaje único: no revela si el usuario existe.
        return reply.status(401).send({ error: 'Usuario o contraseña incorrectos' });
      },
    );

    app.post(
      '/refrescar',
      {
        config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
        schema: {
          tags: ['autenticación'],
          summary: 'Renovar el token de acceso con la cookie de sesión',
          response: { 200: esquemaSesion, 401: esquemaError, 403: esquemaError },
        },
      },
      async (request, reply) => {
        if (!origenPermitido(request, config.CORS_ORIGENES)) {
          return reply.status(403).send({ error: 'Origen no permitido' });
        }
        const token = request.cookies[COOKIE_SESION];
        if (!token) return reply.status(401).send({ error: 'Sin sesión' });
        const resultado = await servicio.refrescar(token, contexto(request));
        if (!resultado.ok) {
          limpiarCookie(reply);
          return reply.status(401).send({ error: 'Sesión no válida o expirada' });
        }
        return responderSesion(reply, resultado.sesion);
      },
    );

    app.post(
      '/salir',
      {
        schema: {
          tags: ['autenticación'],
          summary: 'Cerrar sesión',
          response: { 204: z.null(), 403: esquemaError },
        },
      },
      async (request, reply) => {
        if (!origenPermitido(request, config.CORS_ORIGENES)) {
          return reply.status(403).send({ error: 'Origen no permitido' });
        }
        const token = request.cookies[COOKIE_SESION];
        if (token) await servicio.cerrarSesion(token);
        limpiarCookie(reply);
        return reply.status(204).send(null);
      },
    );

    app.get(
      '/yo',
      {
        preHandler: autenticarConClavePendiente,
        schema: {
          tags: ['autenticación'],
          summary: 'Usuario de la sesión actual',
          security: [{ bearer: [] }],
          response: { 200: esquemaUsuario, 401: esquemaError },
        },
      },
      async (request) => request.usuarioSesion!,
    );

    app.post(
      '/cambiar-clave',
      {
        preHandler: autenticarConClavePendiente,
        config: { rateLimit: { max: config.LOGIN_LIMITE_POR_MINUTO, timeWindow: '1 minute' } },
        schema: {
          tags: ['autenticación'],
          summary: 'Cambiar la contraseña propia (cierra las demás sesiones)',
          security: [{ bearer: [] }],
          body: z.object({
            claveActual: z.string().min(1).max(200),
            claveNueva: z.string().min(1).max(200),
          }),
          response: { 200: esquemaSesion, 400: esquemaError, 401: esquemaError, 403: esquemaError },
        },
      },
      async (request, reply) => {
        if (!origenPermitido(request, config.CORS_ORIGENES)) {
          return reply.status(403).send({ error: 'Origen no permitido' });
        }
        const resultado = await servicio.cambiarClave(
          request.usuarioSesion!.id,
          request.body.claveActual,
          request.body.claveNueva,
          contexto(request),
        );
        if (!resultado.ok) {
          return reply.status(400).send({
            error:
              resultado.motivo === 'CLAVE_ACTUAL'
                ? 'La contraseña actual no es correcta.'
                : 'La nueva contraseña no cumple las reglas.',
            problemas: resultado.problemas,
          });
        }
        return responderSesion(reply, resultado.sesion);
      },
    );
  };
