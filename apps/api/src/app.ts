import Fastify, { type FastifyError } from 'fastify';
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
import { rutasSistema } from './rutas/sistema.js';

export async function construirApp(config: Config) {
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

  return app;
}
