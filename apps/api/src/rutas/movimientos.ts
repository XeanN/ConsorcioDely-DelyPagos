import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BaseDatos } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { BusEventos } from '../eventos/bus.js';
import { crearAutenticador, exigirRol } from '../auth/plugin-auth.js';
import { INCLUIR_VISTA, aVista, vistaParaRol } from '../movimientos/vista.js';
import { hoyLima, rangoDiaLima } from '../util/fechas.js';

const CANALES = ['TRANSFERENCIA', 'INTERBANCARIA', 'YAPE', 'PLIN', 'DEPOSITO_AGENCIA'] as const;
const ESTADOS = ['POR_CONCILIAR', 'CONCILIADO', 'PROBABLE', 'SIN_IDENTIFICAR', 'DESCARTADO'] as const;
const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');

const esquemaMovimiento = z.object({
  id: z.string(),
  idBanco: z.string(),
  cuentaId: z.string(),
  banco: z.string(),
  fechaHora: z.string(),
  monto: z.number(),
  moneda: z.enum(['PEN', 'USD']),
  canal: z.enum(CANALES),
  numeroOperacion: z.string(),
  ordenanteNombre: z.string().nullable(),
  ordenanteTipoDoc: z.enum(['DNI', 'RUC', 'CE']).nullable(),
  ordenanteNumeroDoc: z.string().nullable(),
  ordenanteBanco: z.string().nullable(),
  ordenanteCuenta: z.string().nullable(),
  referencia: z.string().nullable(),
  estado: z.enum(ESTADOS),
});

export interface OpcionesMovimientos {
  secreto: string;
  /** Duración máxima de una conexión en vivo; luego el navegador reconecta con un token nuevo. */
  minutosConexion: number;
  maxConexionesPorUsuario?: number;
}

export const rutasMovimientos =
  (db: BaseDatos, bus: BusEventos, opciones: OpcionesMovimientos): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', crearAutenticador(opciones.secreto));
    app.addHook('preHandler', exigirRol('CAJA', 'VENTAS', 'FINANZAS'));
    const comun = { tags: ['movimientos'], security: [{ bearer: [] }] };

    app.get(
      '/movimientos',
      {
        schema: {
          ...comun,
          summary: 'Abonos recibidos, con filtros y búsqueda por monto',
          querystring: z.object({
            fecha: fechaDia.optional(),
            hasta: fechaDia.optional(),
            cuentaId: z.string().max(40).optional(),
            canal: z.enum(CANALES).optional(),
            estado: z.enum(ESTADOS).optional(),
            monto: z.coerce.number().positive().max(10_000_000).optional(),
            q: z.string().trim().min(2).max(60).optional(),
            limite: z.coerce.number().int().min(1).max(200).default(100),
            antesDe: z.iso.datetime().optional(),
          }),
          response: {
            200: z.object({
              items: z.array(esquemaMovimiento),
              siguienteCursor: z.string().nullable(),
            }),
          },
        },
      },
      async (request) => {
        const f = request.query;
        const inicio = rangoDiaLima(f.fecha ?? hoyLima()).desde;
        const fin = rangoDiaLima(f.hasta ?? f.fecha ?? hoyLima()).hasta;

        const where: Prisma.MovimientoWhereInput = {
          tipo: 'ABONO',
          fechaHora: { gte: inicio, lt: f.antesDe ? new Date(f.antesDe) : fin },
          ...(f.cuentaId ? { cuentaId: f.cuentaId } : {}),
          ...(f.canal ? { canal: f.canal } : {}),
          ...(f.monto !== undefined ? { monto: f.monto.toFixed(2) } : {}),
          ...(f.estado === 'POR_CONCILIAR'
            ? { conciliaciones: { none: {} } }
            : f.estado
              ? { conciliaciones: { some: { estado: f.estado } } }
              : {}),
          ...(f.q
            ? {
                OR: [
                  { ordenanteNombre: { contains: f.q, mode: 'insensitive' } },
                  { referencia: { contains: f.q, mode: 'insensitive' } },
                  { numeroOperacion: { contains: f.q } },
                ],
              }
            : {}),
        };

        const filas = await db.movimiento.findMany({
          where,
          include: INCLUIR_VISTA,
          orderBy: [{ fechaHora: 'desc' }, { id: 'desc' }],
          take: f.limite + 1,
        });
        const hayMas = filas.length > f.limite;
        const items = filas.slice(0, f.limite).map((m) => vistaParaRol(aVista(m), request.usuarioSesion!.rol));
        return {
          items,
          siguienteCursor: hayMas ? (items[items.length - 1]?.fechaHora ?? null) : null,
        };
      },
    );

    app.get(
      '/movimientos/resumen',
      {
        schema: {
          ...comun,
          summary: 'Totales del día por canal y moneda',
          querystring: z.object({ fecha: fechaDia.optional() }),
          response: {
            200: z.object({
              fecha: z.string(),
              porCanal: z.array(
                z.object({
                  canal: z.enum(CANALES),
                  moneda: z.enum(['PEN', 'USD']),
                  cantidad: z.number(),
                  total: z.number(),
                }),
              ),
              totales: z.array(
                z.object({ moneda: z.enum(['PEN', 'USD']), cantidad: z.number(), total: z.number() }),
              ),
            }),
          },
        },
      },
      async (request) => {
        const fecha = request.query.fecha ?? hoyLima();
        const { desde, hasta } = rangoDiaLima(fecha);
        const grupos = await db.movimiento.groupBy({
          by: ['canal', 'moneda'],
          where: { tipo: 'ABONO', fechaHora: { gte: desde, lt: hasta } },
          _count: { _all: true },
          _sum: { monto: true },
        });
        const porCanal = grupos.map((g) => ({
          canal: g.canal,
          moneda: g.moneda,
          cantidad: g._count._all,
          total: Number(g._sum.monto ?? 0),
        }));
        const totales = (['PEN', 'USD'] as const)
          .map((moneda) => {
            const deMoneda = porCanal.filter((g) => g.moneda === moneda);
            return {
              moneda,
              cantidad: deMoneda.reduce((s, g) => s + g.cantidad, 0),
              total: Math.round(deMoneda.reduce((s, g) => s + g.total, 0) * 100) / 100,
            };
          })
          .filter((t) => t.cantidad > 0);
        return { fecha, porCanal, totales };
      },
    );

    app.get(
      '/cuentas',
      {
        schema: {
          ...comun,
          summary: 'Cuentas bancarias de Dely',
          response: {
            200: z.array(
              z.object({
                id: z.string(),
                banco: z.string(),
                numero: z.string(),
                moneda: z.enum(['PEN', 'USD']),
                descripcion: z.string().nullable(),
              }),
            ),
          },
        },
      },
      async () =>
        db.cuentaBancaria.findMany({
          where: { activa: true },
          select: { id: true, banco: true, numero: true, moneda: true, descripcion: true },
          orderBy: [{ banco: 'asc' }, { moneda: 'asc' }],
        }),
    );

    // Conexiones en vivo abiertas por usuario (evita que una sola cuenta agote el servidor).
    const conexiones = new Map<string, number>();
    const maxConexiones = opciones.maxConexionesPorUsuario ?? 5;

    app.get(
      '/movimientos/en-vivo',
      {
        schema: {
          ...comun,
          summary: 'Abonos nuevos en tiempo real (Server-Sent Events)',
          description:
            'Flujo text/event-stream. Evento "movimiento" con el mismo formato del listado. ' +
            'La conexión se cierra al vencer el token; el cliente debe reconectar con uno nuevo.',
        },
      },
      async (request, reply) => {
        const usuario = request.usuarioSesion!;
        const abiertas = conexiones.get(usuario.id) ?? 0;
        if (abiertas >= maxConexiones) {
          return reply.status(429).send({ error: 'Demasiadas pantallas en vivo abiertas.' });
        }
        conexiones.set(usuario.id, abiertas + 1);

        reply.hijack();
        const salida = reply.raw;
        salida.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'X-Content-Type-Options': 'nosniff',
        });
        const enviar = (evento: string, datos: unknown) =>
          salida.write(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`);

        salida.write('retry: 3000\n\n');
        enviar('conectado', { hora: new Date().toISOString() });

        const dejarDeEscuchar = bus.on('movimiento.registrado', (m) =>
          enviar('movimiento', vistaParaRol(m, usuario.rol)),
        );
        // Comentario periódico: evita que Cloudflare o un proxy corten la conexión inactiva.
        const latido = setInterval(() => salida.write(': latido\n\n'), 25_000);
        const vencimiento = setTimeout(() => {
          enviar('reconectar', { motivo: 'token-vencido' });
          salida.end();
        }, opciones.minutosConexion * 60_000);

        let cerrada = false;
        const cerrar = () => {
          if (cerrada) return;
          cerrada = true;
          dejarDeEscuchar();
          clearInterval(latido);
          clearTimeout(vencimiento);
          const restantes = (conexiones.get(usuario.id) ?? 1) - 1;
          if (restantes > 0) conexiones.set(usuario.id, restantes);
          else conexiones.delete(usuario.id);
        };
        request.raw.on('close', cerrar);
        salida.on('close', cerrar);
      },
    );
  };
