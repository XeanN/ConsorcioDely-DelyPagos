import type { Config } from '../config.js';
import type { BaseDatos } from '../db/prisma.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';
import { verificarClave } from './claves.js';
import { firmarAcceso, generarTokenRefresco, hashToken } from './tokens.js';
import type { UsuarioSesion } from './tipos.js';

export interface ContextoCliente {
  ip: string | null;
  agenteUsuario: string | null;
}

export interface SesionEmitida {
  usuario: UsuarioSesion;
  accesoToken: string;
  accesoExpiraEn: Date;
  refrescoToken: string;
  refrescoExpiraEn: Date;
}

export type ResultadoLogin =
  | { ok: true; sesion: SesionEmitida }
  | { ok: false; motivo: 'CREDENCIALES'; }
  | { ok: false; motivo: 'BLOQUEADO'; minutosRestantes: number };

export type ResultadoRefresco =
  | { ok: true; sesion: SesionEmitida }
  | { ok: false; motivo: 'INVALIDO' | 'REUTILIZADO' | 'EXPIRADO' | 'USUARIO_INACTIVO' };

const MARGEN_ROTACION_MS = 30_000;

export class ServicioAuth {
  constructor(
    private readonly db: BaseDatos,
    private readonly config: Config & { JWT_SECRETO: string },
  ) {}

  async iniciarSesion(usuario: string, clave: string, cliente: ContextoCliente): Promise<ResultadoLogin> {
    const nombreUsuario = usuario.trim().toLowerCase();
    const registro = await this.db.usuario.findUnique({ where: { usuario: nombreUsuario } });
    const ahora = new Date();

    if (registro?.bloqueadoHasta && registro.bloqueadoHasta > ahora) {
      return {
        ok: false,
        motivo: 'BLOQUEADO',
        minutosRestantes: Math.ceil((registro.bloqueadoHasta.getTime() - ahora.getTime()) / 60_000),
      };
    }

    const claveCorrecta = await verificarClave(registro?.hashClave ?? null, clave);

    if (!registro || !registro.activo || !claveCorrecta) {
      if (registro) await this.registrarFallo(registro.id, registro.intentosFallidos, cliente);
      else {
        await registrarAuditoria(this.db, {
          accion: 'LOGIN_FALLIDO',
          entidad: 'usuario',
          datos: { usuarioIntentado: nombreUsuario.slice(0, 40), ip: cliente.ip, existe: false },
        });
      }
      return { ok: false, motivo: 'CREDENCIALES' };
    }

    await this.db.usuario.update({
      where: { id: registro.id },
      data: { intentosFallidos: 0, bloqueadoHasta: null, ultimoIngresoEn: ahora },
    });
    const sesion = await this.emitirSesion(
      { id: registro.id, usuario: registro.usuario, nombre: registro.nombre, rol: registro.rol },
      cliente,
    );
    await registrarAuditoria(this.db, {
      usuarioId: registro.id,
      accion: 'LOGIN_EXITOSO',
      entidad: 'usuario',
      entidadId: registro.id,
      datos: { ip: cliente.ip },
    });
    return { ok: true, sesion };
  }

  async refrescar(tokenRefresco: string, cliente: ContextoCliente): Promise<ResultadoRefresco> {
    const sesion = await this.db.sesion.findUnique({
      where: { hashToken: hashToken(tokenRefresco) },
      include: { usuario: true },
    });
    if (!sesion) return { ok: false, motivo: 'INVALIDO' };

    if (sesion.revocadaEn) {
      // Sesión cerrada (salir o revocación): no hay rotación que reutilizar.
      if (sesion.reemplazadaPor === null) return { ok: false, motivo: 'INVALIDO' };
      // Dos pestañas refrescando a la vez: la rotación es reciente, no es un robo.
      if (Date.now() - sesion.revocadaEn.getTime() < MARGEN_ROTACION_MS) {
        return { ok: false, motivo: 'INVALIDO' };
      }

      // Un token ya rotado se volvió a usar: posible robo. Se cierran todas las sesiones.
      await this.db.sesion.updateMany({
        where: { usuarioId: sesion.usuarioId, revocadaEn: null },
        data: { revocadaEn: new Date() },
      });
      await registrarAuditoria(this.db, {
        usuarioId: sesion.usuarioId,
        accion: 'REUTILIZACION_TOKEN',
        entidad: 'sesion',
        entidadId: sesion.id,
        datos: { ip: cliente.ip, accionTomada: 'todas las sesiones revocadas' },
      });
      return { ok: false, motivo: 'REUTILIZADO' };
    }
    if (sesion.expiraEn <= new Date()) return { ok: false, motivo: 'EXPIRADO' };
    if (!sesion.usuario.activo) return { ok: false, motivo: 'USUARIO_INACTIVO' };

    const { usuario } = sesion;
    const nueva = await this.emitirSesion(
      { id: usuario.id, usuario: usuario.usuario, nombre: usuario.nombre, rol: usuario.rol },
      cliente,
      sesion.id,
    );
    return { ok: true, sesion: nueva };
  }

  async cerrarSesion(tokenRefresco: string): Promise<void> {
    const sesion = await this.db.sesion.findUnique({ where: { hashToken: hashToken(tokenRefresco) } });
    if (!sesion || sesion.revocadaEn) return;
    await this.db.sesion.update({ where: { id: sesion.id }, data: { revocadaEn: new Date() } });
    await registrarAuditoria(this.db, {
      usuarioId: sesion.usuarioId,
      accion: 'SESION_CERRADA',
      entidad: 'sesion',
      entidadId: sesion.id,
    });
  }

  private async registrarFallo(usuarioId: string, intentosPrevios: number, cliente: ContextoCliente) {
    const intentos = intentosPrevios + 1;
    const bloquear = intentos >= this.config.LOGIN_MAX_INTENTOS;
    await this.db.usuario.update({
      where: { id: usuarioId },
      data: bloquear
        ? {
            intentosFallidos: 0,
            bloqueadoHasta: new Date(Date.now() + this.config.LOGIN_BLOQUEO_MINUTOS * 60_000),
          }
        : { intentosFallidos: intentos },
    });
    await registrarAuditoria(this.db, {
      usuarioId,
      accion: bloquear ? 'CUENTA_BLOQUEADA' : 'LOGIN_FALLIDO',
      entidad: 'usuario',
      entidadId: usuarioId,
      datos: { ip: cliente.ip, intentos },
    });
  }

  private async emitirSesion(
    usuario: UsuarioSesion,
    cliente: ContextoCliente,
    reemplazaA?: string,
  ): Promise<SesionEmitida> {
    const refrescoToken = generarTokenRefresco();
    const refrescoExpiraEn = new Date(Date.now() + this.config.SESION_HORAS * 3_600_000);

    await this.db.$transaction(async (tx) => {
      const creada = await tx.sesion.create({
        data: {
          usuarioId: usuario.id,
          hashToken: hashToken(refrescoToken),
          expiraEn: refrescoExpiraEn,
          ip: cliente.ip,
          agenteUsuario: cliente.agenteUsuario?.slice(0, 200) ?? null,
        },
      });
      if (reemplazaA) {
        await tx.sesion.update({
          where: { id: reemplazaA },
          data: { revocadaEn: new Date(), reemplazadaPor: creada.id },
        });
      }
    });

    const acceso = await firmarAcceso(usuario, this.config.JWT_SECRETO, this.config.ACCESO_MINUTOS);
    return {
      usuario,
      accesoToken: acceso.token,
      accesoExpiraEn: acceso.expiraEn,
      refrescoToken,
      refrescoExpiraEn,
    };
  }
}
