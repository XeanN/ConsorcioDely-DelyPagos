import { randomBytes } from 'node:crypto';
import type { BaseDatos } from '../db/prisma.js';
import type { UsuarioSesion } from '../auth/tipos.js';
import { hashearClave, verificarClave } from '../auth/claves.js';
import { firmarAcceso } from '../auth/tokens.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';

/** Permisos que puede tener un sistema externo. */
export const ALCANCES = {
  pedidos: 'Registrar y consultar pedidos en caja',
  comprobantes: 'Enviar facturas y boletas emitidas por el ERP',
  'movimientos:leer': 'Consultar abonos recibidos y su estado de conciliación',
} as const;

export type Alcance = keyof typeof ALCANCES;

export interface IntegracionVista {
  id: string;
  nombre: string;
  clientId: string;
  alcances: string[];
  activo: boolean;
  ultimoUsoEn: Date | null;
  creadoEn: Date;
}

export class ErrorIntegracion extends Error {
  constructor(
    readonly estado: 400 | 404,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

const CAMPOS = {
  id: true,
  nombre: true,
  clientId: true,
  alcances: true,
  activo: true,
  ultimoUsoEn: true,
  creadoEn: true,
} as const;

const nuevoClientId = () => `dely_cli_${randomBytes(9).toString('base64url')}`;
// 256 bits: imposible de adivinar por fuerza bruta.
const nuevoSecreto = () => `dely_sec_${randomBytes(32).toString('base64url')}`;

export class ServicioIntegraciones {
  constructor(
    private readonly db: BaseDatos,
    private readonly secretoJwt: string,
    private readonly minutosToken: number,
  ) {}

  listar(): Promise<IntegracionVista[]> {
    return this.db.clienteIntegracion.findMany({ select: CAMPOS, orderBy: { creadoEn: 'desc' } });
  }

  /** Crea las credenciales. El secreto se devuelve una sola vez y solo se guarda su hash. */
  async crear(nombre: string, alcances: Alcance[], admin: UsuarioSesion) {
    const clientSecret = nuevoSecreto();
    const creado = await this.db.clienteIntegracion.create({
      data: {
        nombre: nombre.trim(),
        clientId: nuevoClientId(),
        hashSecreto: await hashearClave(clientSecret),
        alcances,
        creadoPorId: admin.id,
      },
      select: CAMPOS,
    });
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'INTEGRACION_CREADA',
      entidad: 'integracion',
      entidadId: creado.id,
      datos: { nombre: creado.nombre, clientId: creado.clientId, alcances },
    });
    return { integracion: creado, clientSecret };
  }

  async cambiarEstado(id: string, activo: boolean, admin: UsuarioSesion): Promise<IntegracionVista> {
    await this.obtener(id);
    const actualizado = await this.db.clienteIntegracion.update({ where: { id }, data: { activo }, select: CAMPOS });
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: activo ? 'INTEGRACION_ACTIVADA' : 'INTEGRACION_REVOCADA',
      entidad: 'integracion',
      entidadId: id,
      datos: { clientId: actualizado.clientId },
    });
    return actualizado;
  }

  /** Nuevo secreto (p. ej. si el anterior se filtró). El anterior deja de servir al instante. */
  async regenerarSecreto(id: string, admin: UsuarioSesion) {
    const actual = await this.obtener(id);
    const clientSecret = nuevoSecreto();
    await this.db.clienteIntegracion.update({ where: { id }, data: { hashSecreto: await hashearClave(clientSecret) } });
    await registrarAuditoria(this.db, {
      usuarioId: admin.id,
      accion: 'INTEGRACION_SECRETO_REGENERADO',
      entidad: 'integracion',
      entidadId: id,
      datos: { clientId: actual.clientId },
    });
    return { clientId: actual.clientId, clientSecret };
  }

  /**
   * OAuth2 client credentials: valida las credenciales y emite un token de corta duración
   * con rol INTEGRACION y solo los alcances concedidos.
   */
  async emitirToken(clientId: string, clientSecret: string, ip: string | null) {
    const registro = await this.db.clienteIntegracion.findUnique({ where: { clientId } });
    // Se verifica igual aunque no exista, para que el tiempo de respuesta no lo revele.
    const valido = await verificarClave(registro?.hashSecreto ?? null, clientSecret);
    if (!registro || !registro.activo || !valido) {
      await registrarAuditoria(this.db, {
        accion: 'INTEGRACION_TOKEN_RECHAZADO',
        entidad: 'integracion',
        entidadId: registro?.id ?? null,
        datos: { clientId: clientId.slice(0, 60), ip, motivo: !registro ? 'no existe' : !registro.activo ? 'revocada' : 'secreto' },
      });
      return null;
    }
    await this.db.clienteIntegracion.update({ where: { id: registro.id }, data: { ultimoUsoEn: new Date() } });
    const { token, expiraEn } = await firmarAcceso(
      {
        id: registro.id,
        usuario: registro.clientId,
        nombre: registro.nombre,
        rol: 'INTEGRACION',
        debeCambiarClave: false,
        alcances: registro.alcances,
      },
      this.secretoJwt,
      this.minutosToken,
    );
    return { token, expiraEn, alcances: registro.alcances };
  }

  private async obtener(id: string) {
    const registro = await this.db.clienteIntegracion.findUnique({ where: { id }, select: CAMPOS });
    if (!registro) throw new ErrorIntegracion(404, 'Integración no encontrada.');
    return registro;
  }
}
