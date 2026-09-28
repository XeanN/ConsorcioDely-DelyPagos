import { execSync } from 'node:child_process';
import path from 'node:path';
import { URL_PRUEBAS } from './bd-pruebas.js';

/** Aplica las migraciones a la base de pruebas antes de ejecutar los tests. */
export default function prepararBaseDatos(): void {
  if (!URL_PRUEBAS) {
    console.log('TEST_DATABASE_URL no configurada: se omiten los tests de integración.');
    return;
  }
  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(import.meta.dirname, '../..'),
    env: { ...process.env, DIRECT_URL: URL_PRUEBAS, DATABASE_URL: URL_PRUEBAS },
    stdio: 'ignore',
  });
}
