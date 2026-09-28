import { cargarConfig } from '../config.js';
import { crearBaseDatos, type BaseDatos } from '../db/prisma.js';

/**
 * URL de la base de pruebas, o undefined si no está configurada (los tests de
 * integración se omiten). Nunca puede ser la base de la aplicación.
 */
export function urlBaseDatosPruebas(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return undefined;
  const nombre = new URL(url).pathname.slice(1);
  const principal = [process.env.DATABASE_URL, process.env.DIRECT_URL]
    .filter(Boolean)
    .map((u) => new URL(u!).pathname.slice(1));
  if (!/prueba|test/i.test(nombre) || principal.includes(nombre)) {
    throw new Error(
      `TEST_DATABASE_URL apunta a "${nombre}". Debe ser una base exclusiva de pruebas (su nombre debe contener "prueba" o "test").`,
    );
  }
  return url;
}

// Carga .env (vía config) antes de leer TEST_DATABASE_URL.
cargarConfig();
export const URL_PRUEBAS = urlBaseDatosPruebas();

export function crearBaseDatosPruebas(): BaseDatos {
  return crearBaseDatos(URL_PRUEBAS);
}

/** Vacía todas las tablas de la base de pruebas. */
export async function limpiarBaseDatos(db: BaseDatos): Promise<void> {
  await db.$executeRaw`TRUNCATE TABLE auditoria, notificaciones, alertas, conciliaciones,
    movimientos, validaciones_proveedor, proveedores, pedidos_caja, comprobantes,
    cuentas_origen_cliente, alias_cliente, clientes, cuentas_bancarias,
    suscripciones_webhook, sesiones, usuarios RESTART IDENTITY CASCADE`;
}
