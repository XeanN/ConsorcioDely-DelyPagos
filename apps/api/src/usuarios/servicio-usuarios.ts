import type { BaseDatos } from '../db/prisma.js';
import type { Rol, UsuarioSesion } from '../auth/tipos.js';
import { hashearClave } from '../auth/claves.js';
import { validarClaveNueva } from '../auth/politica-clave.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';

export interface UsuarioVista {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
  debeCambiarClave: boolean;
  bloqueadoHasta: Date | null;
  ultimoIngresoEn: Date | null;
  creadoEn: Date;
}

export interface DatosNuevoUsuario {
  usuario: string;
  nombre: string;
  rol: Rol;
  correo?: string | null;
  telefono?: string | null;
  claveTemporal: string;
}

export interface CambiosUsuario {
  nombre?: string;
  rol?: Rol;
  correo?: string | null;
  telefono?: string | null;
  activo?: boolean;
}

export class ErrorUsuarios extends Error {
  constructor(
    readonly estado: 400 | 404 | 409,
    mensaje: string,
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
  }
}

const CAMPOS = {
  id: true,
  usuario: true,
  nombre: true,
  rol: true,
  correo: true,
  telefono: true,
  activo: true,
  debeCambiarClave: true,
  bloqueadoHasta: true,
  ultimoIngresoEn: true,
  creadoEn: true,
} as const;

/** Administración de usuarios. Solo la usa el rol ADMIN (lo exige la ruta). */
export class ServicioUsuarios {
  constructor(private readonly db: BaseDatos) {}

  listar(): Promise<UsuarioVista[]> {
    return this.db.usuario.findMany({
      where: { rol: { not: 'INTEGRACION' } },
      orderBy: [{ activo: 'desc' }, { rol: 'asc' }, { usuario: 'asc' }],
      select: CAMPOS,
    });
  }

  async crear(datos: DatosNuevoUsuario, admin: UsuarioSesion): Promise<UsuarioVista> {
    const usuario = datos.usuario.trim().toLowerCase();
    const problemas = validarClaveNueva(datos.claveTemporal, usuario);
    if (problemas.length > 0) {
      throw new ErrorUsuarios(400, 'La contraseña temporal no cumple las reglas.', problemas);
    }
    if (await this.db.usuario.findUnique({ where: { usuario } })) {
      throw new ErrorUsuarios(409, `El usuario "${usuario}" ya existe.`);
    }
    const creado = await this.db.usuario.create({
      data: {
        usuario,
        nombre: datos.nombre.trim(),
        rol: datos.rol,
        correo: datos.correo ?? null,
        telefono: datos.telefono ?? null,
        hashClave: await hashearClave(datos.claveTemporal),
        // La clave la eligió el admin: el usuario debe cambiarla al entrar.
        debeCambiarClave: true,
      },
      select: CAMPOS,
    });
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'USUARIO_CREADO',
      entidad: 'usuario',
      entidadId: creado.id,
      datos: { usuario: creado.usuario, rol: creado.rol },
    });
    return creado;
  }

  async actualizar(id: string, cambios: CambiosUsuario, admin: UsuarioSesion): Promise<UsuarioVista> {
    const actual = await this.obtener(id);
    if (id === admin.id && (cambios.activo === false || (cambios.rol && cambios.rol !== 'ADMIN'))) {
      throw new ErrorUsuarios(400, 'No puede desactivarse ni quitarse el rol de administrador a sí mismo.');
    }
    const dejaDeSerAdminActivo =
      actual.rol === 'ADMIN' &&
      actual.activo &&
      (cambios.activo === false || (cambios.rol !== undefined && cambios.rol !== 'ADMIN'));
    if (dejaDeSerAdminActivo) {
      const adminsActivos = await this.db.usuario.count({ where: { rol: 'ADMIN', activo: true } });
      if (adminsActivos <= 1) {
        throw new ErrorUsuarios(400, 'Debe quedar al menos un administrador activo.');
      }
    }

    const actualizado = await this.db.usuario.update({
      where: { id },
      data: {
        ...(cambios.nombre !== undefined ? { nombre: cambios.nombre.trim() } : {}),
        ...(cambios.rol !== undefined ? { rol: cambios.rol } : {}),
        ...(cambios.correo !== undefined ? { correo: cambios.correo } : {}),
        ...(cambios.telefono !== undefined ? { telefono: cambios.telefono } : {}),
        ...(cambios.activo !== undefined ? { activo: cambios.activo } : {}),
      },
      select: CAMPOS,
    });
    // Desactivar o cambiar el rol cierra sus sesiones: los permisos nuevos rigen de inmediato.
    if (cambios.activo === false || (cambios.rol && cambios.rol !== actual.rol)) {
      await this.revocarSesiones(id);
    }
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'USUARIO_ACTUALIZADO',
      entidad: 'usuario',
      entidadId: id,
      datos: {
        antes: { nombre: actual.nombre, rol: actual.rol, activo: actual.activo },
        despues: { nombre: actualizado.nombre, rol: actualizado.rol, activo: actualizado.activo },
      },
    });
    return actualizado;
  }

  async restablecerClave(id: string, claveTemporal: string, admin: UsuarioSesion): Promise<void> {
    const actual = await this.obtener(id);
    const problemas = validarClaveNueva(claveTemporal, actual.usuario);
    if (problemas.length > 0) {
      throw new ErrorUsuarios(400, 'La contraseña temporal no cumple las reglas.', problemas);
    }
    await this.db.usuario.update({
      where: { id },
      data: {
        hashClave: await hashearClave(claveTemporal),
        debeCambiarClave: true,
        intentosFallidos: 0,
        bloqueadoHasta: null,
      },
    });
    await this.revocarSesiones(id);
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'CLAVE_RESTABLECIDA',
      entidad: 'usuario',
      entidadId: id,
      datos: { usuario: actual.usuario },
    });
  }

  async desbloquear(id: string, admin: UsuarioSesion): Promise<UsuarioVista> {
    await this.obtener(id);
    const actualizado = await this.db.usuario.update({
      where: { id },
      data: { intentosFallidos: 0, bloqueadoHasta: null },
      select: CAMPOS,
    });
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'USUARIO_DESBLOQUEADO',
      entidad: 'usuario',
      entidadId: id,
    });
    return actualizado;
  }

  private async obtener(id: string): Promise<UsuarioVista> {
    const usuario = await this.db.usuario.findUnique({ where: { id }, select: CAMPOS });
    if (!usuario || usuario.rol === 'INTEGRACION') throw new ErrorUsuarios(404, 'Usuario no encontrado.');
    return usuario;
  }

  private async revocarSesiones(usuarioId: string): Promise<void> {
    await this.db.sesion.updateMany({
      where: { usuarioId, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }
}
