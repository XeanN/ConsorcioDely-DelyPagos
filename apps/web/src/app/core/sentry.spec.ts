import { depurarTexto } from './sentry';

describe('depurarTexto (web)', () => {
  it('enmascara documentos, cuentas, correos y montos', () => {
    expect(depurarTexto('RUC 20123456789 pagó S/ 350.00 desde 191-1234567-0-12')).toBe(
      'RUC [dato] pagó [monto] desde [dato]',
    );
    expect(depurarTexto('aviso a ana@dely.pe')).toBe('aviso a [correo]');
  });
});
