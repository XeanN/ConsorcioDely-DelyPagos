/**
 * Reglas de contraseña para mostrar en pantalla mientras se escribe.
 * La API aplica las mismas (y además rechaza contraseñas comunes).
 */
export interface ReglaClave {
  texto: string;
  cumple: boolean;
}

export const LONGITUD_MINIMA_CLAVE = 10;

export function evaluarClave(clave: string, usuario: string): ReglaClave[] {
  return [
    { texto: `Al menos ${LONGITUD_MINIMA_CLAVE} caracteres`, cumple: clave.length >= LONGITUD_MINIMA_CLAVE },
    { texto: 'Una letra minúscula', cumple: /[a-záéíóúñ]/.test(clave) },
    { texto: 'Una letra mayúscula', cumple: /[A-ZÁÉÍÓÚÑ]/.test(clave) },
    { texto: 'Un número', cumple: /\d/.test(clave) },
    {
      texto: 'No contiene el nombre de usuario',
      cumple: !!clave && !(usuario && clave.toLowerCase().includes(usuario.toLowerCase())),
    },
  ];
}

const MINUSCULAS = 'abcdefghijkmnpqrstuvwxyz';
const MAYUSCULAS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const NUMEROS = '23456789';

/** Contraseña temporal aleatoria (sin caracteres confusos como 0/O o 1/l) que cumple las reglas. */
export function generarClaveTemporal(longitud = 12): string {
  const todos = MINUSCULAS + MAYUSCULAS + NUMEROS;
  const azar = (max: number) => {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return buffer[0]! % max;
  };
  const elegir = (juego: string) => juego[azar(juego.length)]!;
  const caracteres = [elegir(MINUSCULAS), elegir(MAYUSCULAS), elegir(NUMEROS)];
  while (caracteres.length < longitud) caracteres.push(elegir(todos));
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = azar(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j]!, caracteres[i]!];
  }
  return caracteres.join('');
}
