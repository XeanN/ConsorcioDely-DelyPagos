import type { Rol } from '../generated/prisma/enums.js';

export type { Rol };

/** Datos del usuario autenticado disponibles en cada petición. */
export interface UsuarioSesion {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  /** Mientras sea true, solo puede cambiar su contraseña o salir. */
  debeCambiarClave: boolean;
  /** Solo sistemas (rol INTEGRACION): permisos concedidos, p. ej. "pedidos". */
  alcances?: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    usuarioSesion?: UsuarioSesion;
  }
}
