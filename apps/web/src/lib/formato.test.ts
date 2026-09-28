import { describe, expect, it } from 'vitest';
import { formatearMonto } from './formato';

describe('formatearMonto', () => {
  it('formatea soles con separador de miles y dos decimales', () => {
    expect(formatearMonto(1234.5)).toBe('S/ 1,234.50');
  });

  it('formatea dólares', () => {
    expect(formatearMonto(350, 'USD')).toBe('US$ 350.00');
  });

  it('coloca el signo antes del símbolo en montos negativos', () => {
    expect(formatearMonto(-80.1)).toBe('-S/ 80.10');
  });
});
