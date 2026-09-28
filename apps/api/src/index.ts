import { cargarConfig } from './config.js';
import { iniciarSentry } from './instrumentacion.js';

const config = cargarConfig();
iniciarSentry(config);

// Se importa después de iniciar Sentry para que pueda instrumentar Fastify.
const { construirApp } = await import('./app.js');
const app = await construirApp(config);

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
