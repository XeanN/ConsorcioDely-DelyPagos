import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/node';
import { depurarEvento, depurarTexto } from './depurar-evento.js';

describe('depurarTexto', () => {
  it('enmascara DNI, RUC y CCI', () => {
    expect(depurarTexto('DNI 45678912')).toBe('DNI [dato]');
    expect(depurarTexto('RUC 20123456789')).toBe('RUC [dato]');
    expect(depurarTexto('CCI 00219100123456701256')).toBe('CCI [dato]');
    expect(depurarTexto('cuenta 191-1234567-0-12')).toBe('cuenta [dato]');
  });

  it('enmascara correos y montos', () => {
    expect(depurarTexto('aviso a ana.quispe@dely.pe')).toBe('aviso a [correo]');
    expect(depurarTexto('pago de S/ 1,234.50')).toBe('pago de [monto]');
    expect(depurarTexto('pago de US$ 350.00')).toBe('pago de [monto]');
  });

  it('conserva el texto sin datos sensibles', () => {
    expect(depurarTexto('Tiempo de espera agotado')).toBe('Tiempo de espera agotado');
  });
});

describe('depurarEvento', () => {
  it('elimina datos de la petición y del usuario', () => {
    const evento = {
      type: undefined,
      user: { id: '1', email: 'x@dely.pe' },
      request: {
        url: '/api/v1/pagos',
        data: { ruc: '20123456789' },
        cookies: { sesion: 'abc' },
        headers: { authorization: 'Bearer secreto' },
        query_string: 'dni=45678912',
      },
      exception: { values: [{ type: 'Error', value: 'RUC 20123456789 no encontrado' }] },
      breadcrumbs: [{ message: 'consulta DNI 45678912', data: { monto: 350 } }],
    } as ErrorEvent;

    const depurado = depurarEvento(evento);

    expect(depurado.user).toBeUndefined();
    expect(depurado.request).toEqual({ url: '/api/v1/pagos' });
    expect(depurado.exception?.values?.[0]?.value).toBe('RUC [dato] no encontrado');
    expect(depurado.breadcrumbs?.[0]).toEqual({ message: 'consulta DNI [dato]' });
  });
});
