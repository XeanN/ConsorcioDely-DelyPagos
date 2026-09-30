import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { Rol, UsuarioSesion } from './tipos.js';

const EMISOR = 'dely-pagos-api';
const AUDIENCIA = 'dely-pagos';
const ROLES: readonly Rol[] = ['VENTAS', 'CAJA', 'FINANZAS', 'ADMIN', 'INTEGRACION'];

const clave = (secreto: string) => new TextEncoder().encode(secreto);

export async function firmarAcceso(
  usuario: UsuarioSesion,
  secreto: string,
  minutos: number,
): Promise<{ token: string; expiraEn: Date }> {
  const expiraEn = new Date(Date.now() + minutos * 60_000);
  const token = await new SignJWT({
    usr: usuario.usuario,
    nom: usuario.nombre,
    rol: usuario.rol,
    dcc: usuario.debeCambiarClave,
    ...(usuario.alcances ? { alc: usuario.alcances } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(usuario.id)
    .setIssuer(EMISOR)
    .setAudience(AUDIENCIA)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiraEn.getTime() / 1000))
    .sign(clave(secreto));
  return { token, expiraEn };
}

/** Verifica firma, emisor, audiencia y vencimiento. Devuelve null si el token no es válido. */
export async function verificarAcceso(token: string, secreto: string): Promise<UsuarioSesion | null> {
  try {
    const { payload } = await jwtVerify(token, clave(secreto), {
      issuer: EMISOR,
      audience: AUDIENCIA,
      algorithms: ['HS256'],
    });
    const rol = payload['rol'];
    if (
      typeof payload.sub !== 'string' ||
      typeof payload['usr'] !== 'string' ||
      typeof payload['nom'] !== 'string' ||
      !ROLES.includes(rol as Rol) ||
      typeof payload['dcc'] !== 'boolean' ||
      (payload['alc'] !== undefined &&
        !(Array.isArray(payload['alc']) && payload['alc'].every((a) => typeof a === 'string')))
    ) {
      return null;
    }
    return {
      id: payload.sub,
      usuario: payload['usr'],
      nombre: payload['nom'],
      rol: rol as Rol,
      debeCambiarClave: payload['dcc'],
      ...(Array.isArray(payload['alc']) ? { alcances: payload['alc'] as string[] } : {}),
    };
  } catch {
    return null;
  }
}

/** Token de refresco opaco (256 bits). Solo se entrega al navegador en una cookie HttpOnly. */
export function generarTokenRefresco(): string {
  return randomBytes(32).toString('base64url');
}

/** En la base solo se guarda el hash: robar la tabla no permite usar las sesiones. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
