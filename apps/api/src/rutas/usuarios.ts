import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BaseDatos } from '../db/prisma.js';
import { crearAutenticador, exigirRol } from '../auth/plugin-auth.js';
import { ErrorUsuarios, ServicioUsuarios } from '../usuarios/servicio-usuarios.js';

// Roles que el admin puede asignar desde la pantalla (INTEGRACION se gestiona aparte).
const rolAsignable = z.enum(['VENTAS', 'CAJA', 'FINANZAS', 'ADMIN']);

const esquemaUsuario = z.object({
  id: z.string(),
  usuario: z.string(),
  nombre: z.string(),
  rol: z.enum(['VENTAS', 'CAJA', 'FINANZAS', 'ADMIN', 'INTEGRACION']),
  correo: z.string().nullable(),
  telefono: z.string().nullable(),
  activo: z.boolean(),
  debeCambiarClave: z.boolean(),
  bloqueadoHasta: z.date().nullable(),
  ultimoIngresoEn: z.date().nullable(),
  creadoEn: z.date(),
});

const esquemaError = z.object({ error: z.string(), problemas: z.array(z.string()).optional() });
const parametroId = z.object({ id: z.uuid() });
const telefono = z
  .string()
  .trim()
  .regex(/^\+?\d{9,15}$/, 'Teléfono con 9 a 15 dígitos')
  .nullable()
  .optional();
const correo = z.email().max(160).nullable().optional();

function responderError(reply: FastifyReply, error: unknown) {
  if (error instanceof ErrorUsuarios) {
    return reply.status(error.estado).send({ error: error.message, problemas: error.problemas });
  }
  throw error;
}

export const rutasUsuarios =
  (db: BaseDatos, secreto: string): FastifyPluginAsyncZod =>
  async (app) => {
    const servicio = new ServicioUsuarios(db);
    app.addHook('preHandler', crearAutenticador(secreto));
    app.addHook('preHandler', exigirRol('ADMIN'));

    const comun = { tags: ['usuarios'], security: [{ bearer: [] }] };

    app.get(
      '/',
      { schema: { ...comun, summary: 'Listar usuarios', response: { 200: z.array(esquemaUsuario) } } },
      async () => servicio.listar(),
    );

    app.post(
      '/',
      {
        schema: {
          ...comun,
          summary: 'Crear usuario (deberá cambiar la contraseña al ingresar)',
          body: z.object({
            usuario: z
              .string()
              .trim()
              .toLowerCase()
              .regex(/^[a-z][a-z0-9._-]{2,39}$/, 'De 3 a 40 caracteres: letras, números, punto, guion'),
            nombre: z.string().trim().min(2).max(120),
            rol: rolAsignable,
            correo,
            telefono,
            claveTemporal: z.string().min(1).max(128),
          }),
          response: { 201: esquemaUsuario, 400: esquemaError, 409: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          const creado = await servicio.crear(request.body, request.usuarioSesion!);
          return reply.status(201).send(creado);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.patch(
      '/:id',
      {
        schema: {
          ...comun,
          summary: 'Editar nombre, rol, contacto o activar/desactivar',
          params: parametroId,
          body: z
            .object({
              nombre: z.string().trim().min(2).max(120).optional(),
              rol: rolAsignable.optional(),
              correo,
              telefono,
              activo: z.boolean().optional(),
            })
            .refine((c) => Object.keys(c).length > 0, 'Indique al menos un cambio'),
          response: { 200: esquemaUsuario, 400: esquemaError, 404: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          return await servicio.actualizar(request.params.id, request.body, request.usuarioSesion!);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.post(
      '/:id/restablecer-clave',
      {
        schema: {
          ...comun,
          summary: 'Asignar una contraseña temporal (cierra sus sesiones)',
          params: parametroId,
          body: z.object({ claveTemporal: z.string().min(1).max(128) }),
          response: { 204: z.null(), 400: esquemaError, 404: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          await servicio.restablecerClave(
            request.params.id,
            request.body.claveTemporal,
            request.usuarioSesion!,
          );
          return reply.status(204).send(null);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.post(
      '/:id/desbloquear',
      {
        schema: {
          ...comun,
          summary: 'Quitar el bloqueo por intentos fallidos',
          params: parametroId,
          response: { 200: esquemaUsuario, 404: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          return await servicio.desbloquear(request.params.id, request.usuarioSesion!);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );
  };
