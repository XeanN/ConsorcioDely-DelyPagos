import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyRequest } from 'fastify';
import { firmarAcceso, generarTokenRefresco, hashToken, verificarAcceso } from './tokens.js';
import { origenPermitido } from './plugin-auth.js';
import { calcularHash, jsonCanonico } from '../auditoria/auditoria.js';

const SECRETO = 'secreto-de-pruebas-con-mas-de-32-caracteres';
const USUARIO = { id: 'u-1', usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA' as const };

describe('tokens de acceso', () => {
  it('firma y verifica un token válido', async () => {
    const { token, expiraEn } = await firmarAcceso(USUARIO, SECRETO, 15);
    expect(expiraEn.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(await verificarAcceso(token, SECRETO)).toEqual(USUARIO);
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const { token } = await firmarAcceso(USUARIO, 'otro-secreto-distinto-de-mas-de-32-car', 15);
    expect(await verificarAcceso(token, SECRETO)).toBeNull();
  });

  it('rechaza un token alterado (p. ej. para subir de rol)', async () => {
    const { token } = await firmarAcceso(USUARIO, SECRETO, 15);
    const [cabecera, cuerpo, firma] = token.split('.');
    const datos = JSON.parse(Buffer.from(cuerpo!, 'base64url').toString());
    const alterado = Buffer.from(JSON.stringify({ ...datos, rol: 'ADMIN' })).toString('base64url');
    expect(await verificarAcceso(`${cabecera}.${alterado}.${firma}`, SECRETO)).toBeNull();
  });

  it('rechaza un token vencido', async () => {
    const { token } = await firmarAcceso(USUARIO, SECRETO, -1);
    expect(await verificarAcceso(token, SECRETO)).toBeNull();
  });

  it('rechaza tokens sin firma (alg "none") y con rol inexistente', async () => {
    const sinFirma = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'u-1', usr: 'x', nom: 'x', rol: 'ADMIN' }),
    ).toString('base64url')}.`;
    expect(await verificarAcceso(sinFirma, SECRETO)).toBeNull();

    const rolFalso = await new SignJWT({ usr: 'x', nom: 'x', rol: 'SUPERUSUARIO' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('u-1')
      .setIssuer('dely-pagos-api')
      .setAudience('dely-pagos')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(SECRETO));
    expect(await verificarAcceso(rolFalso, SECRETO)).toBeNull();
  });

  it('genera tokens de refresco aleatorios y guarda solo su hash', () => {
    const a = generarTokenRefresco();
    const b = generarTokenRefresco();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toContain(a);
  });
});

describe('origenPermitido (CSRF)', () => {
  const peticion = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;
  const lista = ['http://localhost:4200'];

  it('acepta orígenes de la lista blanca y del mismo host', () => {
    expect(origenPermitido(peticion({ origin: 'http://localhost:4200' }), lista)).toBe(true);
    expect(
      origenPermitido(
        peticion({ origin: 'https://demo.trycloudflare.com', host: 'demo.trycloudflare.com' }),
        lista,
      ),
    ).toBe(true);
  });

  it('rechaza un sitio ajeno', () => {
    expect(
      origenPermitido(peticion({ origin: 'https://atacante.example', host: 'localhost:4000' }), lista),
    ).toBe(false);
  });
});

describe('hash encadenado de auditoría', () => {
  const base = {
    fecha: new Date('2026-09-28T15:00:00.000Z'),
    usuarioId: 'u-1',
    accion: 'CONCILIACION_CONFIRMADA',
    entidad: 'conciliacion',
    entidadId: 'c-1',
    datos: { monto: 350, comprobante: 'F001-2345' },
    hashAnterior: null,
  };

  it('el JSON canónico no depende del orden de las claves', () => {
    expect(jsonCanonico({ b: 1, a: { d: 2, c: 3 } })).toBe(jsonCanonico({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it('cualquier cambio en el registro cambia el hash', () => {
    const original = calcularHash(base);
    expect(calcularHash({ ...base })).toBe(original);
    expect(calcularHash({ ...base, datos: { monto: 3500, comprobante: 'F001-2345' } })).not.toBe(original);
    expect(calcularHash({ ...base, usuarioId: 'u-2' })).not.toBe(original);
    expect(calcularHash({ ...base, hashAnterior: 'a'.repeat(64) })).not.toBe(original);
  });
});
