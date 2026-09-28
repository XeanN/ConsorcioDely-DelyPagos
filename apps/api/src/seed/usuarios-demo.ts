import type { Rol } from '../auth/tipos.js';

export interface UsuarioDemo {
  usuario: string;
  clave: string;
  rol: Rol;
  nombre: string;
}

const ROL_POR_PREFIJO: Record<string, { rol: Rol; etiqueta: string }> = {
  ventas: { rol: 'VENTAS', etiqueta: 'Ventas' },
  caja: { rol: 'CAJA', etiqueta: 'Caja' },
  finanzas: { rol: 'FINANZAS', etiqueta: 'Finanzas' },
  admin: { rol: 'ADMIN', etiqueta: 'Administración' },
};

export const LONGITUD_MINIMA_CLAVE_DEMO = 8;

/**
 * Lee "ventas1:ClaveA,caja1:ClaveB". El rol sale del prefijo del usuario
 * (ventas, caja, finanzas, admin) y el número final forma parte del nombre visible.
 */
export function parsearUsuariosDemo(texto: string | undefined): UsuarioDemo[] {
  if (!texto?.trim()) {
    throw new Error(
      'Defina SEED_USUARIOS_DEMO en .env, por ejemplo: ventas1:ClaveSegura1,caja1:ClaveSegura2',
    );
  }
  const vistos = new Set<string>();
  return texto
    .split(',')
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const separador = par.indexOf(':');
      if (separador <= 0) throw new Error(`Formato inválido en SEED_USUARIOS_DEMO: "${par.split(':')[0]}"`);
      const usuario = par.slice(0, separador).trim().toLowerCase();
      const clave = par.slice(separador + 1);
      const coincidencia = /^([a-z]+)(\d*)$/.exec(usuario);
      const tipo = coincidencia ? ROL_POR_PREFIJO[coincidencia[1]!] : undefined;
      if (!coincidencia || !tipo) {
        throw new Error(
          `El usuario "${usuario}" debe empezar con ventas, caja, finanzas o admin (p. ej. caja1).`,
        );
      }
      if (clave.length < LONGITUD_MINIMA_CLAVE_DEMO) {
        throw new Error(`La clave de "${usuario}" debe tener al menos ${LONGITUD_MINIMA_CLAVE_DEMO} caracteres.`);
      }
      if (vistos.has(usuario)) throw new Error(`Usuario repetido en SEED_USUARIOS_DEMO: "${usuario}"`);
      vistos.add(usuario);
      const numero = coincidencia[2];
      return {
        usuario,
        clave,
        rol: tipo.rol,
        nombre: numero ? `${tipo.etiqueta} ${numero}` : tipo.etiqueta,
      };
    });
}
