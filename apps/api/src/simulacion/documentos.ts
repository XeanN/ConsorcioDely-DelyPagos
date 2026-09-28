import type { Aleatorio } from './aleatorio.js';

const PESOS_RUC = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Dígito verificador del RUC (módulo 11, algoritmo de SUNAT). */
export function digitoVerificadorRuc(primeros10: string): number {
  const suma = PESOS_RUC.reduce((acc, peso, i) => acc + peso * Number(primeros10[i]), 0);
  const resultado = 11 - (suma % 11);
  if (resultado === 10) return 0;
  if (resultado === 11) return 1;
  return resultado;
}

export function esRucValido(ruc: string): boolean {
  if (!/^(10|15|17|20)\d{9}$/.test(ruc)) return false;
  return digitoVerificadorRuc(ruc.slice(0, 10)) === Number(ruc[10]);
}

export function esDniValido(dni: string): boolean {
  return /^\d{8}$/.test(dni);
}

/** RUC 20 = persona jurídica; RUC 10 = persona natural con negocio (10 + DNI). */
export function generarRuc(aleatorio: Aleatorio, prefijo: '10' | '20', dni?: string): string {
  const cuerpo = prefijo === '10' && dni ? dni : aleatorio.digitos(8);
  const primeros10 = `${prefijo}${cuerpo}`;
  return `${primeros10}${digitoVerificadorRuc(primeros10)}`;
}

export function generarDni(aleatorio: Aleatorio): string {
  return `${aleatorio.entero(1, 7)}${aleatorio.digitos(7)}`;
}

export function generarCelular(aleatorio: Aleatorio): string {
  return `+519${aleatorio.digitos(8)}`;
}

/** Códigos de entidad usados en los CCI (primeros 3 dígitos). */
export const CODIGO_BANCO: Record<string, string> = {
  BCP: '002',
  INTERBANK: '003',
  SCOTIABANK: '009',
  BBVA: '011',
  BANBIF: '038',
  PICHINCHA: '035',
};

/** CCI simulado de 20 dígitos (entidad + oficina + cuenta + control). Solo formato. */
export function generarCci(aleatorio: Aleatorio, banco: keyof typeof CODIGO_BANCO): string {
  return `${CODIGO_BANCO[banco]}${aleatorio.digitos(17)}`;
}

/** Número de cuenta BCP simulado con el formato 191-1234567-0-12. */
export function generarCuentaBcp(aleatorio: Aleatorio): string {
  return `${aleatorio.elegir(['191', '193', '194'])}-${aleatorio.digitos(7)}-${aleatorio.entero(0, 1)}-${aleatorio.digitos(2)}`;
}
