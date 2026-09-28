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

const esquemaConfig = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: numero(4000),
    CORS_ORIGENES: listaCsv('http://localhost:4200'),
    CONFIAR_PROXY: booleano(false),
    DOCS_HABILITADOS: booleano(true),
    RATE_LIMIT_MAX: numero(300),
    RATE_LIMIT_VENTANA: z.string().default('1 minute'),
    BANK_PROVIDER: z.enum(['mock', 'bcp-rest', 'bcp-h2h']).default('mock'),
    MOCK_INTERVALO_MIN_S: numero(10),
    MOCK_INTERVALO_MAX_S: numero(40),
    SENTRY_DSN: opcional,
    SENTRY_DSN_WEB: opcional,
    SENTRY_ENTORNO: z.string().default('desarrollo'),
  })
  .refine((c) => !c.CORS_ORIGENES.includes('*'), {
    message: 'no se permite "*"; indique los orígenes explícitamente',
    path: ['CORS_ORIGENES'],
  });

export type Config = z.infer<typeof esquemaConfig>;

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
