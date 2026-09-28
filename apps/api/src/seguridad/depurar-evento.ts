import type { ErrorEvent } from '@sentry/node';

// DNI (8), RUC (11), números de cuenta y CCI (hasta 20 dígitos, con o sin guiones).
const PATRON_DOCUMENTO_O_CUENTA = /\b\d[\d-]{6,22}\d\b/g;
const PATRON_CORREO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PATRON_MONTO = /\b(S\/|US\$)\s?[\d,]+(\.\d+)?/gi;

export function depurarTexto(texto: string): string {
  return texto
    .replace(PATRON_CORREO, '[correo]')
    .replace(PATRON_MONTO, '[monto]')
    .replace(PATRON_DOCUMENTO_O_CUENTA, '[dato]');
}

/**
 * Quita datos personales y financieros de un evento antes de enviarlo a Sentry.
 * Se eliminan cuerpo, cookies, cabeceras y query de la petición, y se enmascaran
 * documentos, cuentas, correos y montos en los mensajes.
 */
export function depurarEvento(evento: ErrorEvent): ErrorEvent {
  if (evento.request) {
    delete evento.request.data;
    delete evento.request.cookies;
    delete evento.request.headers;
    delete evento.request.query_string;
  }
  delete evento.user;

  if (evento.message) evento.message = depurarTexto(evento.message);
  for (const excepcion of evento.exception?.values ?? []) {
    if (excepcion.value) excepcion.value = depurarTexto(excepcion.value);
  }
  for (const miga of evento.breadcrumbs ?? []) {
    if (miga.message) miga.message = depurarTexto(miga.message);
    delete miga.data;
  }
  return evento;
}
