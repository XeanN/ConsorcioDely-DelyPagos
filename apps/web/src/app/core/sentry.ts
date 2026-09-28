import * as Sentry from '@sentry/angular';
import type { ConfiguracionPublica } from './configuracion';

const PATRON_DATO = /\b\d[\d-]{6,22}\d\b/g;
const PATRON_CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PATRON_MONTO = /\b(S\/|US\$)\s?[\d,]+(\.\d+)?/gi;

export function depurarTexto(texto: string): string {
  return texto
    .replace(PATRON_CORREO, '[correo]')
    .replace(PATRON_MONTO, '[monto]')
    .replace(PATRON_DATO, '[dato]');
}

/** Activa Sentry solo si la API entrega un DSN. Nunca envía datos personales ni financieros. */
export function iniciarSentry(config: ConfiguracionPublica | null): void {
  if (!config?.sentryDsn) return;
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.entorno,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    tracesSampleRate: 0,
    beforeSend(evento) {
      delete evento.user;
      delete evento.request;
      for (const excepcion of evento.exception?.values ?? []) {
        if (excepcion.value) excepcion.value = depurarTexto(excepcion.value);
      }
      if (evento.message) evento.message = depurarTexto(evento.message);
      return evento;
    },
    beforeBreadcrumb(miga) {
      // Las migas de UI y de red pueden contener textos de pantalla o URLs con datos.
      if (miga.category === 'ui.input' || miga.category === 'console') return null;
      delete miga.data;
      if (miga.message) miga.message = depurarTexto(miga.message);
      return miga;
    },
  });
}
