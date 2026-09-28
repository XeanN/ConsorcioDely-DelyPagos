import * as Sentry from '@sentry/node';
import type { Config } from './config.js';
import { depurarEvento } from './seguridad/depurar-evento.js';

/** Activa Sentry solo si hay DSN configurado. Nunca envía datos personales. */
export function iniciarSentry(config: Config): boolean {
  if (!config.SENTRY_DSN) return false;
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.SENTRY_ENTORNO,
    // Nada de datos de usuario, cabeceras, cuerpos, parámetros SQL ni variables locales.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      genAI: { inputs: false, outputs: false },
      graphQL: { document: false, variables: false },
    },
    tracesSampleRate: 0,
    beforeSend: depurarEvento,
  });
  return true;
}
