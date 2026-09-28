import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import * as Sentry from '@sentry/node';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { BaseDatos } from './db/prisma.js';
import { rutasAuditoria } from './rutas/auditoria.js';
import { rutasAuth } from './rutas/auth.js';
import { rutasSistema } from './rutas/sistema.js';
import { rutasUsuarios } from './rutas/usuarios.js';

export interface Dependencias {
  db?: BaseDatos;
}

export async function construirApp(config: Config, dependencias: Dependencias = {}) {
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers.authorization', 'req.headers.cookie'] },
    // Solo detrás de Cloudflare u otro proxy de confianza; si no, X-Forwarded-For sería falsificable.
    trustProxy: config.CONFIAR_PROXY,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
  });

  await app.register(cookie);

  await app.register(cors, {
    origin: config.CORS_ORIGENES,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  await app.register(rateLimit, {
    max: config.RATE_LIMIT_MAX,
    timeWindow: config.RATE_LIMIT_VENTANA,
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Dely Pagos API',
        version: '1.0.0',
        description: 'Contrato de integración de Dely Pagos para sistemas internos y externos.',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    },
    transform: jsonSchemaTransform,
  });

  if (config.DOCS_HABILITADOS) {
    await app.register(swaggerUi, { routePrefix: '/api/docs', staticCSP: true });
  }

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.validation) {
      return reply.status(400).send({ error: 'Solicitud inválida', detalle: error.validation });
    }
    const estado = error.statusCode ?? 500;
    if (estado >= 500) {
      request.log.error(error);
      Sentry.captureException(error);
      return reply.status(500).send({ error: 'Error interno del servidor' });
    }
    return reply.status(estado).send({ error: error.message });
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send({ error: 'No encontrado' }));

  await app.register(rutasSistema(config), { prefix: '/api/v1' });

  const { db } = dependencias;
  if (db) {
    if (!config.JWT_SECRETO) {
      throw new Error('Falta JWT_SECRETO (mínimo 32 caracteres) para habilitar la autenticación.');
    }
    const configAuth = { ...config, JWT_SECRETO: config.JWT_SECRETO };
    await app.register(rutasAuth(db, configAuth), { prefix: '/api/v1/auth' });
    await app.register(rutasAuditoria(db, configAuth.JWT_SECRETO), { prefix: '/api/v1/auditoria' });
    await app.register(rutasUsuarios(db, configAuth.JWT_SECRETO), { prefix: '/api/v1/usuarios' });
  }

  return app;
}
