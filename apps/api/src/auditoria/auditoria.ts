import { createHash } from 'node:crypto';
import type { BaseDatos } from '../db/prisma.js';

export interface EntradaAuditoria {
  usuarioId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  datos?: Record<string, unknown>;
}

interface RegistroEncadenado {
  fecha: Date;
  usuarioId: string | null;
  accion: string;
  entidad: string;
  entidadId: string | null;
  datos: unknown;
  hashAnterior: string | null;
}

/** JSON con claves ordenadas: el mismo contenido siempre produce el mismo texto. */
export function jsonCanonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  const claves = Object.keys(valor as Record<string, unknown>)
    .filter((k) => (valor as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${claves
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico((valor as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

/** Cada registro incluye el hash del anterior: alterar uno rompe toda la cadena siguiente. */
export function calcularHash(r: RegistroEncadenado): string {
  return createHash('sha256')
    .update(
      jsonCanonico([
        r.hashAnterior ?? '',
        r.fecha.toISOString(),
        r.usuarioId ?? '',
        r.accion,
        r.entidad,
        r.entidadId ?? '',
        r.datos ?? {},
      ]),
    )
    .digest('hex');
}

// Serializa las inserciones para que dos registros simultáneos no compartan el mismo anterior.
const CANDADO_AUDITORIA = 727_274;

type Transaccion = Parameters<Parameters<BaseDatos['$transaction']>[0]>[0];

/** Registra una acción en la auditoría (solo inserción; la base rechaza UPDATE y DELETE). */
export async function registrarAuditoria(
  db: BaseDatos | Transaccion,
  entrada: EntradaAuditoria,
): Promise<void> {
  const insertar = async (tx: Transaccion) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CANDADO_AUDITORIA})`;
    const ultimo = await tx.auditoria.findFirst({ orderBy: { id: 'desc' }, select: { hash: true } });
    const registro: RegistroEncadenado = {
      fecha: new Date(),
      usuarioId: entrada.usuarioId ?? null,
      accion: entrada.accion,
      entidad: entrada.entidad,
      entidadId: entrada.entidadId ?? null,
      datos: JSON.parse(jsonCanonico(entrada.datos ?? {})),
      hashAnterior: ultimo?.hash ?? null,
    };
    await tx.auditoria.create({
      data: {
        fecha: registro.fecha,
        usuarioId: registro.usuarioId,
        accion: registro.accion,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        datos: registro.datos as object,
        hashAnterior: registro.hashAnterior,
        hash: calcularHash(registro),
      },
    });
  };
  // Dentro de una transacción existente se reutiliza; si no, se abre una.
  if ('$transaction' in db) await db.$transaction(insertar);
  else await insertar(db);
}

export interface ResultadoVerificacion {
  valida: boolean;
  registros: number;
  primerIdAlterado: string | null;
}

/** Recalcula toda la cadena y detecta el primer registro alterado. */
export async function verificarCadena(db: BaseDatos): Promise<ResultadoVerificacion> {
  let anterior: string | null = null;
  let cursor: bigint | undefined;
  let registros = 0;
  for (;;) {
    const lote = await db.auditoria.findMany({
      orderBy: { id: 'asc' },
      take: 500,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (lote.length === 0) break;
    for (const r of lote) {
      const esperado = calcularHash({
        fecha: r.fecha,
        usuarioId: r.usuarioId,
        accion: r.accion,
        entidad: r.entidad,
        entidadId: r.entidadId,
        datos: r.datos,
        hashAnterior: anterior,
      });
      if (r.hashAnterior !== anterior || r.hash !== esperado) {
        return { valida: false, registros, primerIdAlterado: r.id.toString() };
      }
      anterior = r.hash;
      registros++;
    }
    cursor = lote[lote.length - 1]!.id;
  }
  return { valida: true, registros, primerIdAlterado: null };
}
