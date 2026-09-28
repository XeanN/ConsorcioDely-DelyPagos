import type { Aleatorio } from './aleatorio.js';

export const NOMBRES_MASCULINOS = [
  'JUAN', 'CARLOS', 'JOSE', 'LUIS', 'JORGE', 'MIGUEL', 'VICTOR', 'CESAR', 'WILBER', 'EDWIN',
  'FREDDY', 'HUGO', 'RAUL', 'PERCY', 'ROGER', 'ALBERTO', 'ELMER', 'WALTER', 'MARCO', 'DIEGO',
] as const;

export const NOMBRES_FEMENINOS = [
  'MARIA', 'ROSA', 'CARMEN', 'LUZ', 'ANA', 'JULIA', 'ELENA', 'SONIA', 'YOLANDA', 'GLADYS',
  'NELLY', 'MARLENE', 'LIZ', 'FLOR', 'VILMA', 'EDITH', 'KATHERINE', 'LUCIA', 'PAOLA', 'ROXANA',
] as const;

export const APELLIDOS = [
  'QUISPE', 'MAMANI', 'HUAMAN', 'FLORES', 'RODRIGUEZ', 'SANCHEZ', 'GARCIA', 'ROJAS', 'CHAVEZ',
  'VARGAS', 'RAMOS', 'CONDORI', 'TORRES', 'MENDOZA', 'CASTILLO', 'CCAHUANA', 'HUANCA', 'PAUCAR',
  'TICONA', 'APAZA', 'CUSI', 'VILCA', 'YUPANQUI', 'ESPINOZA', 'SALAZAR', 'POMA', 'CHOQUE',
  'GUTIERREZ', 'NUÑEZ', 'CÁCERES', 'ÑAHUI', 'ZEVALLOS',
] as const;

export const CIUDADES_PROVINCIA = [
  'HUANCAYO', 'AREQUIPA', 'CUSCO', 'TRUJILLO', 'PIURA', 'CHICLAYO', 'PUNO', 'JULIACA',
  'AYACUCHO', 'HUANUCO', 'ICA', 'TACNA', 'CAJAMARCA', 'HUARAZ', 'TARAPOTO', 'ABANCAY',
] as const;

const GIROS = ['DISTRIBUIDORA', 'COMERCIAL', 'INVERSIONES', 'NEGOCIACIONES', 'CORPORACION', 'MULTISERVICIOS'];
const SUFIJOS_EMPRESA = ['S.A.C.', 'E.I.R.L.', 'S.R.L.', 'S.A.'];

export interface PersonaSimulada {
  nombres: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
}

export function generarPersona(aleatorio: Aleatorio): PersonaSimulada {
  const lista = aleatorio.probabilidad(0.5) ? NOMBRES_MASCULINOS : NOMBRES_FEMENINOS;
  const primero = aleatorio.elegir(lista);
  const segundo = aleatorio.probabilidad(0.6) ? ` ${aleatorio.elegir(lista)}` : '';
  return {
    nombres: primero === segundo.trim() ? primero : `${primero}${segundo}`,
    apellidoPaterno: aleatorio.elegir(APELLIDOS),
    apellidoMaterno: aleatorio.elegir(APELLIDOS),
  };
}

export function nombreCompleto(p: PersonaSimulada): string {
  return `${p.nombres} ${p.apellidoPaterno} ${p.apellidoMaterno}`;
}

export function generarRazonSocial(aleatorio: Aleatorio): string {
  const giro = aleatorio.elegir(GIROS);
  const nucleo = aleatorio.probabilidad(0.5)
    ? `${aleatorio.elegir(APELLIDOS)} ${aleatorio.elegir(CIUDADES_PROVINCIA)}`
    : `${aleatorio.elegir(APELLIDOS)} & ${aleatorio.elegir(APELLIDOS)}`;
  return `${giro} ${nucleo} ${aleatorio.elegir(SUFIJOS_EMPRESA)}`;
}

/**
 * Variantes con las que un nombre suele llegar en el banco:
 * abreviado ("JUAN C QUISPE M"), sin segundo apellido o truncado.
 */
export function variarNombrePersona(aleatorio: Aleatorio, p: PersonaSimulada): string {
  const [primerNombre, segundoNombre] = p.nombres.split(' ');
  return aleatorio.elegirPonderado<string>([
    [nombreCompleto(p), 3],
    [`${primerNombre} ${segundoNombre ? `${segundoNombre[0]} ` : ''}${p.apellidoPaterno} ${p.apellidoMaterno[0]}`, 3],
    [`${primerNombre} ${p.apellidoPaterno}`, 2],
    [`${p.apellidoPaterno} ${p.apellidoMaterno} ${primerNombre}`, 1],
    [nombreCompleto(p).slice(0, 20).trim(), 1],
  ]);
}

/** Variantes de una razón social: sin sufijo, con abreviaturas o truncada a 30 caracteres. */
export function variarRazonSocial(aleatorio: Aleatorio, razonSocial: string): string {
  const sinSufijo = razonSocial.replace(/\s+(S\.A\.C\.|E\.I\.R\.L\.|S\.R\.L\.|S\.A\.)$/, '');
  const abreviada = sinSufijo
    .replace('DISTRIBUIDORA', 'DISTRIB.')
    .replace('COMERCIAL', 'COM.')
    .replace('INVERSIONES', 'INV.')
    .replace('NEGOCIACIONES', 'NEG.')
    .replace('CORPORACION', 'CORP.')
    .replace('MULTISERVICIOS', 'MULTISERV.');
  return aleatorio.elegirPonderado<string>([
    [razonSocial, 2],
    [sinSufijo, 2],
    [abreviada, 3],
    [razonSocial.slice(0, 30).trim(), 1],
  ]);
}

/** Familiar del titular: comparte apellidos pero con otro nombre. */
export function generarFamiliar(aleatorio: Aleatorio, p: PersonaSimulada): PersonaSimulada {
  const lista = aleatorio.probabilidad(0.5) ? NOMBRES_MASCULINOS : NOMBRES_FEMENINOS;
  const nombres = aleatorio.elegir(lista.filter((n) => !p.nombres.startsWith(n)));
  return aleatorio.probabilidad(0.6)
    ? { nombres, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: p.apellidoMaterno }
    : { nombres, apellidoPaterno: p.apellidoPaterno, apellidoMaterno: aleatorio.elegir(APELLIDOS) };
}
