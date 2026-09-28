import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../app.js';
import { cargarConfig } from '../config.js';
import { hashearClave } from '../auth/claves.js';
import { URL_PRUEBAS, crearBaseDatosPruebas, limpiarBaseDatos } from '../test/bd-pruebas.js';
import type { BaseDatos } from '../db/prisma.js';

const CONFIG = cargarConfig({
  NODE_ENV: 'test',
  JWT_SECRETO: 'secreto-de-pruebas-con-mas-de-32-caracteres',
  LOGIN_LIMITE_POR_MINUTO: '1000',
  RATE_LIMIT_MAX: '1000',
});
const ORIGEN = { origin: 'http://localhost:4200' };
const CLAVE = 'ClavePrueba-X1';

describe.skipIf(!URL_PRUEBAS)('administración de usuarios y cambio de contraseña', () => {
  let db: BaseDatos;
  let app: Awaited<ReturnType<typeof construirApp>>;
  let adminId: string;

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
    const hashClave = await hashearClave(CLAVE);
    const admin = await db.usuario.create({
      data: { usuario: 'admin1', nombre: 'Administración 1', rol: 'ADMIN', hashClave },
    });
    adminId = admin.id;
    await db.usuario.create({ data: { usuario: 'caja1', nombre: 'Caja 1', rol: 'CAJA', hashClave } });
  });

  const ingresar = async (usuario: string, clave = CLAVE) => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGEN,
      payload: { usuario, clave },
    });
    return r.json() as { accesoToken: string; usuario: { debeCambiarClave: boolean } };
  };
  const conToken = (token: string) => ({ ...ORIGEN, authorization: `Bearer ${token}` });

  it('solo el admin puede administrar usuarios', async () => {
    const caja = await ingresar('caja1');
    const r = await app.inject({ url: '/api/v1/usuarios/', headers: conToken(caja.accesoToken) });
    expect(r.statusCode).toBe(403);
  });

  it('lista usuarios sin exponer el hash de la contraseña', async () => {
    const admin = await ingresar('admin1');
    const r = await app.inject({ url: '/api/v1/usuarios/', headers: conToken(admin.accesoToken) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toHaveLength(2);
    expect(r.body).not.toContain('hashClave');
    expect(r.body).not.toContain('$argon2');
  });

  it('crea un usuario que debe cambiar su contraseña al ingresar', async () => {
    const admin = await ingresar('admin1');
    const creado = await app.inject({
      method: 'POST',
      url: '/api/v1/usuarios/',
      headers: conToken(admin.accesoToken),
      payload: { usuario: 'Ventas2', nombre: 'Ventas 2', rol: 'VENTAS', claveTemporal: 'Temporal-2026a' },
    });
    expect(creado.statusCode).toBe(201);
    expect(creado.json()).toMatchObject({ usuario: 'ventas2', rol: 'VENTAS', debeCambiarClave: true });

    const nuevo = await ingresar('ventas2', 'Temporal-2026a');
    expect(nuevo.usuario.debeCambiarClave).toBe(true);
    // Con la contraseña pendiente de cambio, el resto de la API está cerrado.
    const bloqueado = await app.inject({ url: '/api/v1/usuarios/', headers: conToken(nuevo.accesoToken) });
    expect(bloqueado.statusCode).toBe(403);
    expect(bloqueado.json().codigo).toBe('DEBE_CAMBIAR_CLAVE');
    const yo = await app.inject({ url: '/api/v1/auth/yo', headers: conToken(nuevo.accesoToken) });
    expect(yo.statusCode).toBe(200);

    const cambio = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/cambiar-clave',
      headers: conToken(nuevo.accesoToken),
      payload: { claveActual: 'Temporal-2026a', claveNueva: 'MiPropiaClave-77' },
    });
    expect(cambio.statusCode).toBe(200);
    expect(cambio.json().usuario.debeCambiarClave).toBe(false);
    expect((await ingresar('ventas2', 'MiPropiaClave-77')).accesoToken).toBeTruthy();
  });

  it('rechaza contraseñas temporales débiles y usuarios duplicados', async () => {
    const admin = await ingresar('admin1');
    const debil = await app.inject({
      method: 'POST',
      url: '/api/v1/usuarios/',
      headers: conToken(admin.accesoToken),
      payload: { usuario: 'caja2', nombre: 'Caja 2', rol: 'CAJA', claveTemporal: 'corta' },
    });
    expect(debil.statusCode).toBe(400);
    expect(debil.json().problemas.length).toBeGreaterThan(0);

    const duplicado = await app.inject({
      method: 'POST',
      url: '/api/v1/usuarios/',
      headers: conToken(admin.accesoToken),
      payload: { usuario: 'caja1', nombre: 'Otra', rol: 'CAJA', claveTemporal: 'Temporal-2026a' },
    });
    expect(duplicado.statusCode).toBe(409);
  });

  it('no permite crear usuarios de integración desde la pantalla', async () => {
    const admin = await ingresar('admin1');
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/usuarios/',
      headers: conToken(admin.accesoToken),
      payload: { usuario: 'erp1', nombre: 'ERP', rol: 'INTEGRACION', claveTemporal: 'Temporal-2026a' },
    });
    expect(r.statusCode).toBe(400);
  });

  it('desactivar a un usuario cierra sus sesiones de inmediato', async () => {
    const admin = await ingresar('admin1');
    const cajaId = (await db.usuario.findUniqueOrThrow({ where: { usuario: 'caja1' } })).id;
    await ingresar('caja1');
    const r = await app.inject({
      method: 'PATCH',
      url: `/api/v1/usuarios/${cajaId}`,
      headers: conToken(admin.accesoToken),
      payload: { activo: false },
    });
    expect(r.statusCode).toBe(200);
    expect(await db.sesion.count({ where: { usuarioId: cajaId, revocadaEn: null } })).toBe(0);
    const intento = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: ORIGEN,
      payload: { usuario: 'caja1', clave: CLAVE },
    });
    expect(intento.statusCode).toBe(401);
  });

  it('el admin no puede desactivarse ni quitarse el rol a sí mismo', async () => {
    const admin = await ingresar('admin1');
    for (const payload of [{ activo: false }, { rol: 'CAJA' }]) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/usuarios/${adminId}`,
        headers: conToken(admin.accesoToken),
        payload,
      });
      expect(r.statusCode).toBe(400);
    }
  });

  it('restablecer la contraseña obliga a cambiarla y desbloquea la cuenta', async () => {
    const admin = await ingresar('admin1');
    const caja = await db.usuario.update({
      where: { usuario: 'caja1' },
      data: { bloqueadoHasta: new Date(Date.now() + 3_600_000) },
    });
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/usuarios/${caja.id}/restablecer-clave`,
      headers: conToken(admin.accesoToken),
      payload: { claveTemporal: 'Temporal-2026b' },
    });
    expect(r.statusCode).toBe(204);
    const sesion = await ingresar('caja1', 'Temporal-2026b');
    expect(sesion.usuario.debeCambiarClave).toBe(true);
    const acciones = (await db.auditoria.findMany()).map((a) => a.accion);
    expect(acciones).toContain('CLAVE_RESTABLECIDA');
  });

  it('cambiar la contraseña exige la actual y aplica las reglas', async () => {
    const caja = await ingresar('caja1');
    const cambiar = (claveActual: string, claveNueva: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/cambiar-clave',
        headers: conToken(caja.accesoToken),
        payload: { claveActual, claveNueva },
      });
    expect((await cambiar('incorrecta', 'OtraClave-2026')).statusCode).toBe(400);
    const debil = await cambiar(CLAVE, 'debil');
    expect(debil.statusCode).toBe(400);
    expect(debil.json().problemas).toContain('Debe incluir una letra mayúscula.');
    expect((await cambiar(CLAVE, CLAVE)).json().problemas).toContain(
      'Debe ser distinta de la contraseña actual.',
    );
  });
});
