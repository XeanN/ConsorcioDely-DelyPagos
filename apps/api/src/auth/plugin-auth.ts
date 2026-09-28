import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { verificarAcceso } from './tokens.js';
import type { Rol } from './tipos.js';

/** Verifica el token Bearer y deja el usuario en `request.usuarioSesion`. */
export function crearAutenticador(secreto: string): preHandlerAsyncHookHandler {
  return async function autenticar(request: FastifyRequest, reply: FastifyReply) {
    const cabecera = request.headers.authorization;
    const token = cabecera?.startsWith('Bearer ') ? cabecera.slice(7) : null;
    const usuario = token ? await verificarAcceso(token, secreto) : null;
    if (!usuario) {
      return reply.status(401).send({ error: 'Sesión no válida o expirada' });
    }
    request.usuarioSesion = usuario;
  };
}

/** Exige uno de los roles indicados. ADMIN tiene acceso a todo. Usar después de autenticar. */
export function exigirRol(...roles: Rol[]): preHandlerAsyncHookHandler {
  return async function verificarRol(request: FastifyRequest, reply: FastifyReply) {
    const rol = request.usuarioSesion?.rol;
    if (!rol || (rol !== 'ADMIN' && !roles.includes(rol))) {
      return reply.status(403).send({ error: 'No tiene permiso para esta acción' });
    }
  };
}

/**
 * Protección CSRF adicional para las rutas que usan la cookie de sesión:
 * el Origin debe estar en la lista blanca o coincidir con el host de la petición.
 */
export function origenPermitido(request: FastifyRequest, lista: readonly string[]): boolean {
  const origen = request.headers.origin;
  if (!origen) return true; // Clientes no navegadores: igual necesitan la cookie.
  if (lista.includes(origen)) return true;
  try {
    const host = request.headers['x-forwarded-host'] ?? request.headers.host;
    return new URL(origen).host === host;
  } catch {
    return false;
  }
}
