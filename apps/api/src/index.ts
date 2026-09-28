import { cargarConfig } from './config.js';
import { iniciarSentry } from './instrumentacion.js';
import { crearBaseDatos } from './db/prisma.js';

const config = cargarConfig();
iniciarSentry(config);

// Se importa después de iniciar Sentry para que pueda instrumentar Fastify.
const { construirApp } = await import('./app.js');
const db = crearBaseDatos(config.DATABASE_URL);
const app = await construirApp(config, { db });

app.addHook('onClose', async () => {
  await db.$disconnect();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
