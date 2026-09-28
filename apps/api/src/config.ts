import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv.config({ path: path.join(raizRepo, '.env') });

const numero = (porDefecto: number) => z.coerce.number().default(porDefecto);

const esquemaConfig = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: numero(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  BANK_PROVIDER: z.enum(['mock', 'bcp-rest', 'bcp-h2h']).default('mock'),
  MOCK_INTERVALO_MIN_S: numero(10),
  MOCK_INTERVALO_MAX_S: numero(40),
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
