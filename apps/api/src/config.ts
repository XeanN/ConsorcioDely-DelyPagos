import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raizRepo, '.env'), quiet: true });

const numero = (porDefecto: number) => z.coerce.number().default(porDefecto);
const booleano = (porDefecto: boolean) =>
  z
    .enum(['true', 'false'])
    .default(porDefecto ? 'true' : 'false')
    .transform((v) => v === 'true');
const listaCsv = (porDefecto: string) =>
  z
    .string()
    .default(porDefecto)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
const opcional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);

/** Fuera de localhost, la conexión a PostgreSQL debe ir cifrada. */
export function conexionSegura(url: string): boolean {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    return false;
  }
  if (HOSTS_LOCALES.has(destino.hostname)) return true;
  return ['require', 'verify-ca', 'verify-full'].includes(
    destino.searchParams.get('sslmode') ?? '',
  );
}

const urlBaseDatos = opcional.refine((v) => v === undefined || conexionSegura(v), {
  message: 'fuera de localhost la conexión debe usar sslmode=require o verify-full',
});

const esquemaConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: numero(4000),
    DATABASE_URL: urlBaseDatos,
    DIRECT_URL: urlBaseDatos,
    CORS_ORIGENES: listaCsv('http://localhost:4200'),
    CONFIAR_PROXY: booleano(false),
    DOCS_HABILITADOS: booleano(true),
    RATE_LIMIT_MAX: numero(300),
    RATE_LIMIT_VENTANA: z.string().default('1 minute'),
    BANK_PROVIDER: z.enum(['mock', 'bcp-rest', 'bcp-h2h']).default('mock'),
    MOCK_INTERVALO_MIN_S: numero(10),
    MOCK_INTERVALO_MAX_S: numero(40),
    /** Secreto para firmar los tokens de acceso (HS256). */
    JWT_SECRETO: opcional.refine((v) => v === undefined || v.length >= 32, {
      message: 'debe tener al menos 32 caracteres',
    }),
    ACCESO_MINUTOS: numero(15),
    SESION_HORAS: numero(12),
    LOGIN_MAX_INTENTOS: numero(5),
    LOGIN_BLOQUEO_MINUTOS: numero(15),
    /** Intentos de login por IP y minuto (además del bloqueo por usuario). */
    LOGIN_LIMITE_POR_MINUTO: numero(10),
    /** Usuarios de demo: "usuario:clave,usuario:clave". El rol sale del prefijo (ventas, caja, finanzas, admin). */
    SEED_USUARIOS_DEMO: opcional,
    // Motor de conciliación (ver CLAUDE.md, módulo 2)
    CONCILIACION_PESO_MONTO: numero(0.35),
    CONCILIACION_PESO_NOMBRE: numero(0.25),
    CONCILIACION_PESO_REFERENCIA: numero(0.2),
    CONCILIACION_PESO_CUENTA_ORIGEN: numero(0.2),
    CONCILIACION_UMBRAL_CONCILIADO: numero(0.85),
    CONCILIACION_UMBRAL_PROBABLE: numero(0.6),
    CONCILIACION_VENTANA_PEDIDO_MIN: numero(30),
    CONCILIACION_TOLERANCIA_MONTO: numero(1),
    SENTRY_DSN: opcional,
    SENTRY_DSN_WEB: opcional,
    SENTRY_ENTORNO: z.string().default('desarrollo'),
  })
  .refine((c) => !c.CORS_ORIGENES.includes('*'), {
    message: 'no se permite "*"; indique los orígenes explícitamente',
    path: ['CORS_ORIGENES'],
  });

export type Config = z.infer<typeof esquemaConfig>;

/** Parámetros del motor de conciliación tomados de la configuración. */
export function configMotor(c: Config) {
  return {
    pesos: {
      monto: c.CONCILIACION_PESO_MONTO,
      nombre: c.CONCILIACION_PESO_NOMBRE,
      referencia: c.CONCILIACION_PESO_REFERENCIA,
      cuenta: c.CONCILIACION_PESO_CUENTA_ORIGEN,
    },
    umbralConciliado: c.CONCILIACION_UMBRAL_CONCILIADO,
    umbralProbable: c.CONCILIACION_UMBRAL_PROBABLE,
    ventanaPedidoMin: c.CONCILIACION_VENTANA_PEDIDO_MIN,
    toleranciaMonto: c.CONCILIACION_TOLERANCIA_MONTO,
    margenEmpate: 0.1,
  };
}

export function cargarConfig(entorno: NodeJS.ProcessEnv = process.env): Config {
  const resultado = esquemaConfig.safeParse(entorno);
  if (!resultado.success) {
    const detalle = resultado.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}
