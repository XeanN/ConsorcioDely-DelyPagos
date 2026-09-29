const formateador = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "S/ 1,234.50" o "US$ 1,234.50" (formato del proyecto). */
export function formatearSoles(monto: number, moneda: 'PEN' | 'USD' = 'PEN'): string {
  return `${moneda === 'USD' ? 'US$' : 'S/'} ${formateador.format(monto)}`;
}
