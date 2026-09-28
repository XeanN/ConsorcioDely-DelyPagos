export type Moneda = 'PEN' | 'USD';

const SIMBOLOS: Record<Moneda, string> = { PEN: 'S/', USD: 'US$' };

const formateador = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formatea un monto como "S/ 1,234.50" o "US$ 1,234.50". */
export function formatearMonto(monto: number, moneda: Moneda = 'PEN'): string {
  const signo = monto < 0 ? '-' : '';
  return `${signo}${SIMBOLOS[moneda]} ${formateador.format(Math.abs(monto))}`;
}
