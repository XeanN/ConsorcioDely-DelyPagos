import { cargarConfig } from './config.js';
import { construirApp } from './app.js';

const config = cargarConfig();
const app = await construirApp(config);

try {
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
