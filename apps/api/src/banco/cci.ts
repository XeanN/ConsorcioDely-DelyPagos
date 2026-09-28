import { CciInvalidoError } from './errores.js';

/** Quita espacios y guiones que suelen copiarse junto con el CCI. */
export function limpiarCci(cci: string): string {
  return cci.replace(/[\s-]/g, '');
}

export function esFormatoCciValido(cci: string): boolean {
  return /^\d{20}$/.test(limpiarCci(cci));
}

/** Devuelve el CCI limpio o lanza `CciInvalidoError`. */
export function exigirCciValido(cci: string): string {
  const limpio = limpiarCci(cci);
  if (!/^\d{20}$/.test(limpio)) throw new CciInvalidoError();
  return limpio;
}
