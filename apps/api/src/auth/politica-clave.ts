export const LONGITUD_MINIMA_CLAVE = 10;

// Contraseñas que se prueban primero en un ataque: se rechazan aunque cumplan las reglas.
const COMUNES = [
  'password', 'contraseña', 'contrasena', '123456', '12345678', 'qwerty', 'admin', 'dely',
  'delypagos', 'consorcio', 'peru', 'lima', 'bienvenido', 'cambiar', 'clave',
];

/**
 * Reglas para contraseñas definidas por los usuarios. Devuelve la lista de
 * problemas (vacía si la contraseña es aceptable).
 */
export function validarClaveNueva(clave: string, usuario: string): string[] {
  const problemas: string[] = [];
  if (clave.length < LONGITUD_MINIMA_CLAVE) {
    problemas.push(`Debe tener al menos ${LONGITUD_MINIMA_CLAVE} caracteres.`);
  }
  if (clave.length > 128) problemas.push('Debe tener como máximo 128 caracteres.');
  if (!/[a-záéíóúñ]/.test(clave)) problemas.push('Debe incluir una letra minúscula.');
  if (!/[A-ZÁÉÍÓÚÑ]/.test(clave)) problemas.push('Debe incluir una letra mayúscula.');
  if (!/\d/.test(clave)) problemas.push('Debe incluir un número.');

  const minuscula = clave.toLowerCase();
  if (usuario && minuscula.includes(usuario.toLowerCase())) {
    problemas.push('No debe contener el nombre de usuario.');
  }
  const sinDigitos = minuscula.replace(/[\d\W_]+/g, '');
  if (COMUNES.includes(minuscula) || COMUNES.includes(sinDigitos)) {
    problemas.push('Es una contraseña demasiado común.');
  }
  return problemas;
}
