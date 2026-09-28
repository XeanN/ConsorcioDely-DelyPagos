import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type BaseDatos = PrismaClient;

/**
 * Crea el cliente de base de datos. Toda consulta pasa por Prisma (parametrizada);
 * la URL ya fue validada en `cargarConfig` (TLS obligatorio fuera de localhost).
 */
export function crearBaseDatos(url: string | undefined): BaseDatos {
  if (!url) {
    throw new Error('Falta DATABASE_URL. Copie .env.example a .env y configure la conexión.');
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
