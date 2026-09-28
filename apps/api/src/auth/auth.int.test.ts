import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../app.js';
import { cargarConfig } from '../config.js';
import { hashearClave } from './claves.js';
import { registrarAuditoria, verificarCadena } from '../auditoria/auditoria.js';
import { URL_PRUEBAS, crearBaseDatosPruebas, limpiarBaseDatos } from '../test/bd-pruebas.js';
import type { BaseDatos } from '../db/prisma.js';

const CONFIG = cargarConfig({
  NODE_ENV: 'test',
  JWT_SECRETO: 'secreto-de-pruebas-con-mas-de-32-caracteres',
  LOGIN_MAX_INTENTOS: '3',
  LOGIN_LIMITE_POR_MINUTO: '1000',
  RATE_LIMIT_MAX: '1000',
});
const ORIGEN = { origin: 'http://localhost:4200' };

describe.skipIf(!URL_PRUEBAS)('autenticación (integración con PostgreSQL)', () => {
  let db: BaseDatos;
  let app: Awaited<ReturnType<typeof construirApp>>;

  beforeAll(async () => {
    db = crearBaseDatosPruebas();
    app = await construirApp(CONFIG, { db });
  });

  afterAll(async () => {
    await app.close();
    await db.$disconnect();
  });

  beforeEach(async () => {
    await limpiarBaseDatos(db);
    const hashClave = await hashearClave('ClavePrueba-C1');
    await db.usuario.createMany({
      data: [
        { usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA', hashClave },
        { usuario: 'finanzas1', nombre: 'Finanzas 1', rol: 'FINANZAS', hashClave },
        { usuario: 'inactivo1', nombre: 'Inactivo', rol: 'CAJA', hashClave, activo: false },
      ],
    });
  });

  const login = (usuario: string, clave: string, headers: Record<string, string> = ORIGEN) =>
    app.inject({ method: 'POST', url: '/api/v1/auth/login', headers, payload: { usuario, clave } });

  const cookieDe = (respuesta: Awaited<ReturnType<typeof login>>) =>
    respuesta.cookies.find((c) => c.name === 'dely_sesion');

  it('inicia sesión y entrega token de acceso y cookie segura', async () => {
    const respuesta = await login('CAJA1', 'ClavePrueba-C1');
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.usuario).toMatchObject({ usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA' });
    expect(cuerpo.accesoToken).toBeTruthy();
    expect(cuerpo).not.toHaveProperty('hashClave');

    const cookie = cookieDe(respuesta)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/api/v1/auth' });
    // El token de refresco nunca va en el cuerpo de la respuesta.
    expect(respuesta.body).not.toContain(cookie.value);
  });

  it('usa el mismo mensaje para usuario inexistente y contraseña incorrecta', async () => {
    const inexistente = await login('nadie', 'ClavePrueba-C1');
    const claveMala = await login('caja1', 'otra-clave');
    expect(inexistente.statusCode).toBe(401);
    expect(claveMala.statusCode).toBe(401);
    expect(inexistente.json()).toEqual(claveMala.json());
  });

  it('no deja entrar a un usuario desactivado', async () => {
    expect((await login('inactivo1', 'ClavePrueba-C1')).statusCode).toBe(401);
  });

  it('bloquea la cuenta tras varios intentos fallidos, incluso con la clave correcta', async () => {
    for (let i = 0; i < 3; i++) await login('caja1', 'incorrecta');
    const respuesta = await login('caja1', 'ClavePrueba-C1');
    expect(respuesta.statusCode).toBe(423);
    expect(respuesta.json().error).toMatch(/bloqueada/);
    const acciones = (await db.auditoria.findMany({ orderBy: { id: 'asc' } })).map((a) => a.accion);
    expect(acciones).toEqual(['LOGIN_FALLIDO', 'LOGIN_FALLIDO', 'CUENTA_BLOQUEADA']);
  });

  it('rechaza el login desde un sitio ajeno (CSRF)', async () => {
    const respuesta = await login('caja1', 'ClavePrueba-C1', { origin: 'https://atacante.example' });
    expect(respuesta.statusCode).toBe(403);
  });

  it('valida la entrada', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGEN,
      payload: { usuario: 'x'.repeat(500), clave: 'a' },
    });
    expect(respuesta.statusCode).toBe(400);
  });

  it('/yo exige un token válido', async () => {
    const { accesoToken } = (await login('caja1', 'ClavePrueba-C1')).json();
    const ok = await app.inject({ url: '/api/v1/auth/yo', headers: { authorization: `Bearer ${accesoToken}` } });
    expect(ok.json()).toMatchObject({ usuario: 'caja1', rol: 'CAJA' });
    expect((await app.inject({ url: '/api/v1/auth/yo' })).statusCode).toBe(401);
    const alterado = await app.inject({
      url: '/api/v1/auth/yo',
      headers: { authorization: `Bearer ${accesoToken}x` },
    });
    expect(alterado.statusCode).toBe(401);
  });

  it('rota el token de refresco en cada renovación', async () => {
    const primera = cookieDe(await login('caja1', 'ClavePrueba-C1'))!;
    const refresco = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refrescar',
      headers: ORIGEN,
      cookies: { dely_sesion: primera.value },
    });
    expect(refresco.statusCode).toBe(200);
    const segunda = cookieDe(refresco)!;
    expect(segunda.value).not.toBe(primera.value);
    expect(refresco.json().usuario.usuario).toBe('caja1');
  });

  it('detecta la reutilización de un token rotado y cierra todas las sesiones', async () => {
    const robada = cookieDe(await login('caja1', 'ClavePrueba-C1'))!;
    const legitima = cookieDe(
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/refrescar',
        headers: ORIGEN,
        cookies: { dely_sesion: robada.value },
      }),
    )!;
    // Fuera del margen de gracia de 30 s para pestañas simultáneas.
    await db.sesion.updateMany({
      where: { revocadaEn: { not: null } },
      data: { revocadaEn: new Date(Date.now() - 60_000) },
    });

    const ataque = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refrescar',
      headers: ORIGEN,
      cookies: { dely_sesion: robada.value },
    });
    expect(ataque.statusCode).toBe(401);

    // La sesión legítima también queda cerrada: el usuario debe volver a entrar.
    const despues = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refrescar',
      headers: ORIGEN,
      cookies: { dely_sesion: legitima.value },
    });
    expect(despues.statusCode).toBe(401);
    expect(await db.auditoria.count({ where: { accion: 'REUTILIZACION_TOKEN' } })).toBe(1);
  });

  it('cerrar sesión invalida el token de refresco', async () => {
    const cookie = cookieDe(await login('caja1', 'ClavePrueba-C1'))!;
    const salir = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/salir',
      headers: ORIGEN,
      cookies: { dely_sesion: cookie.value },
    });
    expect(salir.statusCode).toBe(204);
    const refresco = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refrescar',
      headers: ORIGEN,
      cookies: { dely_sesion: cookie.value },
    });
    expect(refresco.statusCode).toBe(401);
  });

  it('la base guarda solo el hash del token de refresco', async () => {
    const cookie = cookieDe(await login('caja1', 'ClavePrueba-C1'))!;
    const sesiones = await db.sesion.findMany();
    expect(sesiones).toHaveLength(1);
    expect(sesiones[0]!.hashToken).not.toBe(cookie.value);
  });

  describe('roles', () => {
    const verificacion = async (usuario: string) => {
      const { accesoToken } = (await login(usuario, 'ClavePrueba-C1')).json();
      return app.inject({
        url: '/api/v1/auditoria/verificacion',
        headers: { authorization: `Bearer ${accesoToken}` },
      });
    };

    it('caja no puede ver la auditoría', async () => {
      expect((await verificacion('caja1')).statusCode).toBe(403);
    });

    it('finanzas sí puede verificarla', async () => {
      const respuesta = await verificacion('finanzas1');
      expect(respuesta.statusCode).toBe(200);
      expect(respuesta.json()).toMatchObject({ valida: true });
    });
  });

  describe('auditoría con hash encadenado', () => {
    it('la cadena es válida tras varias acciones', async () => {
      await login('caja1', 'ClavePrueba-C1');
      await login('caja1', 'mala');
      await login('finanzas1', 'ClavePrueba-C1');
      const resultado = await verificarCadena(db);
      expect(resultado).toEqual({ valida: true, registros: 3, primerIdAlterado: null });
    });

    it('detecta un registro alterado aunque alguien desactive el trigger', async () => {
      for (let i = 0; i < 3; i++) {
        await registrarAuditoria(db, { accion: 'PRUEBA', entidad: 'test', datos: { i } });
      }
      const [, segundo] = await db.auditoria.findMany({ orderBy: { id: 'asc' } });
      // Simula un atacante con privilegios de dueño de la base.
      await db.$executeRaw`ALTER TABLE auditoria DISABLE TRIGGER auditoria_sin_update_ni_delete`;
      await db.$executeRaw`UPDATE auditoria SET datos = '{"i": 99}'::jsonb WHERE id = ${segundo!.id}`;
      await db.$executeRaw`ALTER TABLE auditoria ENABLE TRIGGER auditoria_sin_update_ni_delete`;

      const resultado = await verificarCadena(db);
      expect(resultado.valida).toBe(false);
      expect(resultado.primerIdAlterado).toBe(segundo!.id.toString());
    });

    it('la base rechaza modificar o borrar registros de auditoría', async () => {
      await registrarAuditoria(db, { accion: 'PRUEBA', entidad: 'test' });
      await expect(db.auditoria.updateMany({ data: { accion: 'X' } })).rejects.toThrow(/solo inserción/);
      await expect(db.auditoria.deleteMany()).rejects.toThrow(/solo inserción/);
    });

    it('registros simultáneos no rompen la cadena', async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          registrarAuditoria(db, { accion: 'CONCURRENTE', entidad: 'test', datos: { i } }),
        ),
      );
      expect(await verificarCadena(db)).toMatchObject({ valida: true, registros: 8 });
    });
  });
});
