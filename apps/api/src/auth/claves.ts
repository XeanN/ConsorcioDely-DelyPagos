import { hash, verify } from '@node-rs/argon2';

/** Argon2id con los parámetros por defecto recomendados (OWASP). */
export function hashearClave(clave: string): Promise<string> {
  return hash(clave);
}

// Hash de una clave aleatoria: se verifica contra él cuando el usuario no existe,
// para que el tiempo de respuesta no revele qué usuarios existen.
let hashFicticio: Promise<string> | undefined;

export async function verificarClave(hashGuardado: string | null, clave: string): Promise<boolean> {
  if (!hashGuardado) {
    hashFicticio ??= hash(`ficticia-${Math.random()}`);
    await verify(await hashFicticio, clave).catch(() => false);
    return false;
  }
  return verify(hashGuardado, clave).catch(() => false);
}
