import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { verificarAcceso } from './tokens.js';
import type { Rol, UsuarioSesion } from './tipos.js';

/**
 * Verifica el token Bearer y deja el usuario en `request.usuarioSesion`.
 * Si el usuario debe cambiar su contraseña, solo pasa por rutas que lo permitan.
 */
export function crearAutenticador(
  secreto: string,
  { permitirClavePendiente = false }: { permitirClavePendiente?: boolean } = {},
): preHandlerAsyncHookHandler {
  return async function autenticar(request: FastifyRequest, reply: FastifyReply) {
    const cabecera = request.headers.authorization;
    const token = cabecera?.startsWith('Bearer ') ? cabecera.slice(7) : null;
    const usuario = token ? await verificarAcceso(token, secreto) : null;
    if (!usuario) {
      return reply.status(401).send({ error: 'Sesión no válida o expirada' });
    }
    if (usuario.debeCambiarClave && !permitirClavePendiente) {
      return reply
        .status(403)
        .send({ error: 'Debe cambiar su contraseña antes de continuar', codigo: 'DEBE_CAMBIAR_CLAVE' });
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
 * Personas por rol o sistemas externos por alcance. Un sistema (rol INTEGRACION) solo
 * pasa si su token incluye el alcance pedido; nunca por rol.
 */
export function exigirAcceso(roles: Rol[], alcance: string): preHandlerAsyncHookHandler {
  return async function verificarAcceso(request: FastifyRequest, reply: FastifyReply) {
    const sesion = request.usuarioSesion;
    if (sesion?.rol === 'INTEGRACION') {
      if (!sesion.alcances?.includes(alcance)) {
        return reply.status(403).send({ error: `La integración no tiene el permiso "${alcance}"` });
      }
      return;
    }
    const rol = sesion?.rol;
    if (!rol || (rol !== 'ADMIN' && !roles.includes(rol))) {
      return reply.status(403).send({ error: 'No tiene permiso para esta acción' });
    }
  };
}

/**
 * Quién hizo la acción, para guardar y auditar. Los sistemas no son usuarios: se
 * registran sin usuarioId y con su identificación en los datos.
 */
export function actorDe(sesion: UsuarioSesion): { usuarioId: string | null; datos: Record<string, string> } {
  if (sesion.rol === 'INTEGRACION') {
    return { usuarioId: null, datos: { integracion: sesion.nombre, clientId: sesion.usuario } };
  }
  return { usuarioId: sesion.id, datos: {} };
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
