import { z } from 'zod';
import type { FastifyReply } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { BaseDatos } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { BusEventos } from '../eventos/bus.js';
import { actorDe, crearAutenticador, exigirAcceso, exigirRol } from '../auth/plugin-auth.js';
import type { ConfigMotor, Evaluacion } from '../conciliacion/motor.js';
import { ErrorConciliacion, ServicioConciliacion } from '../conciliacion/servicio-conciliacion.js';
import { INCLUIR_VISTA, aVista, vistaParaRol } from '../movimientos/vista.js';
import { registrarAuditoria } from '../auditoria/auditoria.js';
import { hoyLima, rangoDiaLima } from '../util/fechas.js';

const fechaDia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato AAAA-MM-DD');
const esquemaError = z.object({ error: z.string() });
const moneda = z.enum(['PEN', 'USD']);

function responderError(reply: FastifyReply, error: unknown) {
  if (error instanceof ErrorConciliacion) return reply.status(error.estado).send({ error: error.message });
  throw error;
}

export const rutasConciliacion =
  (db: BaseDatos, bus: BusEventos, secreto: string, cfg: ConfigMotor): FastifyPluginAsyncZod =>
  async (app) => {
    const servicio = new ServicioConciliacion(db, bus, cfg, app.log);
    const autenticar = crearAutenticador(secreto);
    const comun = { security: [{ bearer: [] }] };
    const cajaYFinanzas = { preHandler: [autenticar, exigirRol('CAJA', 'FINANZAS')] };
    const todos = { preHandler: [autenticar, exigirRol('CAJA', 'VENTAS', 'FINANZAS')] };

    // ─── Conciliaciones ────────────────────────────────────

    app.get(
      '/conciliaciones',
      {
        ...cajaYFinanzas,
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Pagos por estado de conciliación (bandeja de trabajo)',
          querystring: z.object({
            estado: z.enum(['CONCILIADO', 'PROBABLE', 'SIN_IDENTIFICAR', 'DESCARTADO']),
            fecha: fechaDia.optional(),
            limite: z.coerce.number().int().min(1).max(200).default(100),
          }),
        },
      },
      async (request) => {
        const { estado, fecha, limite } = request.query;
        const rango = fecha ? rangoDiaLima(fecha) : null;
        const filas = await db.conciliacion.findMany({
          where: {
            estado,
            ...(rango ? { movimiento: { fechaHora: { gte: rango.desde, lt: rango.hasta } } } : {}),
          },
          include: {
            movimiento: { include: INCLUIR_VISTA },
            confirmadoPor: { select: { nombre: true } },
          },
          orderBy: { movimiento: { fechaHora: 'desc' } },
          take: limite,
        });
        return filas.map((c) => ({
          id: c.id,
          estado: c.estado,
          puntaje: Number(c.puntaje),
          motivos: c.motivos as string[],
          candidatos: (c.candidatos ?? []) as unknown as Evaluacion[],
          destino: c.comprobanteId
            ? { tipo: 'COMPROBANTE' as const, id: c.comprobanteId }
            : c.pedidoId
              ? { tipo: 'PEDIDO' as const, id: c.pedidoId }
              : null,
          montoAplicado: c.montoAplicado === null ? null : Number(c.montoAplicado),
          confirmadoPor: c.confirmadoPor?.nombre ?? null,
          confirmadoEn: c.confirmadoEn?.toISOString() ?? null,
          movimiento: vistaParaRol(aVista(c.movimiento), request.usuarioSesion!.rol),
        }));
      },
    );

    app.get(
      '/conciliaciones/movimiento/:movimientoId',
      {
        ...todos,
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Por qué un pago quedó con su estado (explicación)',
          params: z.object({ movimientoId: z.uuid() }),
        },
      },
      async (request, reply) => {
        const c = await db.conciliacion.findFirst({
          where: { movimientoId: request.params.movimientoId },
          include: { confirmadoPor: { select: { nombre: true } } },
          orderBy: { creadoEn: 'desc' },
        });
        if (!c) return reply.status(404).send({ error: 'Este pago aún no se ha conciliado.' });
        return {
          id: c.id,
          estado: c.estado,
          puntaje: Number(c.puntaje),
          motivos: c.motivos as string[],
          candidatos: (c.candidatos ?? []) as unknown as Evaluacion[],
          confirmadoPor: c.confirmadoPor?.nombre ?? null,
          confirmadoEn: c.confirmadoEn?.toISOString() ?? null,
        };
      },
    );

    app.post(
      '/conciliaciones/:id/confirmar',
      {
        ...cajaYFinanzas,
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Confirmar a qué pedido o comprobante corresponde el pago',
          params: z.object({ id: z.uuid() }),
          body: z.object({ tipo: z.enum(['PEDIDO', 'COMPROBANTE']), destinoId: z.uuid() }),
          response: { 204: z.null(), 400: esquemaError, 404: esquemaError, 409: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          await servicio.confirmar(
            request.params.id,
            { tipo: request.body.tipo, id: request.body.destinoId },
            request.usuarioSesion!,
          );
          return reply.status(204).send(null);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.post(
      '/conciliaciones/:id/descartar',
      {
        ...cajaYFinanzas,
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Marcar que el pago no corresponde a una venta',
          params: z.object({ id: z.uuid() }),
          body: z.object({ motivo: z.string().trim().min(3).max(200) }),
          response: { 204: z.null(), 404: esquemaError, 409: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          await servicio.descartar(request.params.id, request.body.motivo, request.usuarioSesion!);
          return reply.status(204).send(null);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.post(
      '/conciliaciones/:id/revertir',
      {
        preHandler: [autenticar, exigirRol('FINANZAS')],
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Deshacer una conciliación o un descarte equivocado (vuelve a la bandeja)',
          params: z.object({ id: z.uuid() }),
          body: z.object({ motivo: z.string().trim().min(5).max(200) }),
          response: { 204: z.null(), 404: esquemaError, 409: esquemaError },
        },
      },
      async (request, reply) => {
        try {
          await servicio.revertir(request.params.id, request.body.motivo, request.usuarioSesion!);
          return reply.status(204).send(null);
        } catch (error) {
          return responderError(reply, error);
        }
      },
    );

    app.post(
      '/conciliaciones/procesar',
      {
        preHandler: [autenticar, exigirRol('FINANZAS')],
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Conciliar los pagos de un día que aún no tienen decisión',
          body: z.object({ fecha: fechaDia.optional() }),
          response: { 200: z.object({ procesados: z.number() }) },
        },
      },
      async (request) => {
        const { desde, hasta } = rangoDiaLima(request.body.fecha ?? hoyLima());
        return { procesados: await servicio.procesarPendientes(desde, hasta) };
      },
    );

    app.get(
      '/conciliaciones/destinos',
      {
        ...cajaYFinanzas,
        schema: {
          ...comun,
          tags: ['conciliación'],
          summary: 'Buscar pedidos abiertos y comprobantes pendientes para asignar un pago',
          querystring: z.object({ q: z.string().trim().max(60).default(''), moneda: moneda.default('PEN') }),
        },
      },
      async (request) => {
        const { q, moneda: mon } = request.query;
        const serieNumero = /^([FB]\d{3})[\s-]*0*(\d{1,8})$/i.exec(q);
        const filtroCliente: Prisma.ClienteWhereInput | undefined = q
          ? { OR: [{ nombre: { contains: q, mode: 'insensitive' } }, { numeroDoc: { startsWith: q } }] }
          : undefined;
        const [pedidos, comprobantes] = await Promise.all([
          db.pedidoCaja.findMany({
            where: { estado: 'ABIERTO', moneda: mon, ...(filtroCliente && !serieNumero ? { cliente: filtroCliente } : {}) },
            include: { cliente: { select: { nombre: true } } },
            orderBy: { creadoEn: 'desc' },
            take: 20,
          }),
          db.comprobante.findMany({
            where: {
              estado: { in: ['PENDIENTE', 'PARCIAL'] },
              moneda: mon,
              ...(serieNumero
                ? { serie: serieNumero[1]!.toUpperCase(), numero: Number(serieNumero[2]) }
                : filtroCliente
                  ? { cliente: filtroCliente }
                  : {}),
            },
            include: { cliente: { select: { nombre: true } } },
            orderBy: { fechaEmision: 'asc' },
            take: 30,
          }),
        ]);
        return [
          ...pedidos.map((p) => ({
            tipo: 'PEDIDO' as const,
            id: p.id,
            descripcion: `Pedido ${p.caja} (${p.tienda})${p.cliente ? ` · ${p.cliente.nombre}` : ''}`,
            pendiente: Number(p.monto),
            fecha: p.creadoEn.toISOString(),
          })),
          ...comprobantes.map((c) => ({
            tipo: 'COMPROBANTE' as const,
            id: c.id,
            descripcion: `${c.serie}-${String(c.numero).padStart(8, '0')} · ${c.cliente.nombre}`,
            pendiente: Number(c.saldoPendiente),
            fecha: c.fechaEmision.toISOString(),
          })),
        ];
      },
    );

    // ─── Pedidos en caja (personas o el ERP con alcance "pedidos") ───

    const verPedidos = { preHandler: [autenticar, exigirAcceso(['CAJA', 'VENTAS', 'FINANZAS'], 'pedidos')] };
    const gestionarPedidos = { preHandler: [autenticar, exigirAcceso(['CAJA', 'FINANZAS'], 'pedidos')] };

    app.get(
      '/pedidos',
      {
        ...verPedidos,
        schema: {
          ...comun,
          tags: ['pedidos en caja'],
          summary: 'Pedidos esperando pago y los pagados hoy',
          querystring: z.object({ estado: z.enum(['ABIERTO', 'PAGADO', 'CANCELADO']).default('ABIERTO') }),
        },
      },
      async (request) => {
        const { estado } = request.query;
        const pedidos = await db.pedidoCaja.findMany({
          where: {
            estado,
            ...(estado === 'ABIERTO' ? {} : { cerradoEn: { gte: rangoDiaLima(hoyLima()).desde } }),
          },
          include: { cliente: { select: { nombre: true } } },
          orderBy: { creadoEn: 'desc' },
          take: 50,
        });
        return pedidos.map((p) => ({
          id: p.id,
          idExterno: p.idExterno,
          tienda: p.tienda,
          caja: p.caja,
          monto: Number(p.monto),
          moneda: p.moneda,
          estado: p.estado,
          cliente: p.cliente?.nombre ?? null,
          creadoEn: p.creadoEn.toISOString(),
          cerradoEn: p.cerradoEn?.toISOString() ?? null,
        }));
      },
    );

    app.post(
      '/pedidos',
      {
        ...gestionarPedidos,
        schema: {
          ...comun,
          tags: ['pedidos en caja'],
          summary: 'Registrar un pedido que espera pago por Yape, Plin o transferencia',
          description:
            'Desde el ERP: enviar idExterno (el número de pedido del ERP) para que un reenvío no duplique ' +
            'el pedido, y identificar al cliente con clienteDocumento.',
          body: z
            .object({
              monto: z.number().positive().max(1_000_000).multipleOf(0.01),
              moneda: moneda.default('PEN'),
              tienda: z.string().trim().min(2).max(60),
              caja: z.string().trim().min(1).max(20),
              clienteId: z.uuid().nullable().optional(),
              clienteDocumento: z
                .object({ tipoDoc: z.enum(['DNI', 'RUC', 'CE']), numeroDoc: z.string().regex(/^\d{8,12}$/) })
                .optional(),
              idExterno: z.string().trim().min(1).max(80).optional(),
            })
            .refine((b) => !(b.clienteId && b.clienteDocumento), 'Use clienteId o clienteDocumento, no ambos'),
          response: {
            200: z.object({ id: z.string(), duplicado: z.literal(true) }),
            201: z.object({ id: z.string() }),
            400: esquemaError,
          },
        },
      },
      async (request, reply) => {
        const b = request.body;
        if (b.idExterno) {
          const existente = await db.pedidoCaja.findUnique({ where: { idExterno: b.idExterno } });
          if (existente) return reply.status(200).send({ id: existente.id, duplicado: true as const });
        }
        let clienteId = b.clienteId ?? null;
        if (b.clienteDocumento) {
          const cliente = await db.cliente.findUnique({
            where: { tipoDoc_numeroDoc: b.clienteDocumento },
            select: { id: true },
          });
          if (!cliente) return reply.status(400).send({ error: 'No existe un cliente con ese documento.' });
          clienteId = cliente.id;
        }
        const actor = actorDe(request.usuarioSesion!);
        const pedido = await db.pedidoCaja.create({
          data: {
            monto: b.monto.toFixed(2),
            moneda: b.moneda,
            tienda: b.tienda,
            caja: b.caja,
            clienteId,
            idExterno: b.idExterno ?? null,
            creadoPorId: actor.usuarioId,
          },
        });
        await registrarAuditoria(db, {
          usuarioId: actor.usuarioId,
          accion: 'PEDIDO_CREADO',
          entidad: 'pedido',
          entidadId: pedido.id,
          datos: { ...actor.datos, monto: b.monto, moneda: b.moneda, caja: b.caja, idExterno: b.idExterno ?? null },
        });
        return reply.status(201).send({ id: pedido.id });
      },
    );

    app.post(
      '/pedidos/:id/cancelar',
      {
        ...gestionarPedidos,
        schema: {
          ...comun,
          tags: ['pedidos en caja'],
          summary: 'Cancelar un pedido que ya no se pagará',
          params: z.object({ id: z.uuid() }),
          response: { 204: z.null(), 409: esquemaError },
        },
      },
      async (request, reply) => {
        const r = await db.pedidoCaja.updateMany({
          where: { id: request.params.id, estado: 'ABIERTO' },
          data: { estado: 'CANCELADO', cerradoEn: new Date() },
        });
        if (r.count === 0) return reply.status(409).send({ error: 'El pedido ya no está abierto.' });
        const actor = actorDe(request.usuarioSesion!);
        await registrarAuditoria(db, {
          usuarioId: actor.usuarioId,
          accion: 'PEDIDO_CANCELADO',
          entidad: 'pedido',
          entidadId: request.params.id,
          datos: actor.datos,
        });
        return reply.status(204).send(null);
      },
    );

    // ─── Clientes (búsqueda para pedidos) ─────────────────

    app.get(
      '/clientes',
      {
        ...todos,
        schema: {
          ...comun,
          tags: ['clientes'],
          summary: 'Buscar clientes por nombre o documento',
          querystring: z.object({ q: z.string().trim().min(2).max(60) }),
        },
      },
      async (request) =>
        db.cliente.findMany({
          where: {
            OR: [
              { nombre: { contains: request.query.q, mode: 'insensitive' } },
              { numeroDoc: { startsWith: request.query.q } },
            ],
          },
          select: { id: true, nombre: true, tipoDoc: true, numeroDoc: true, tipo: true },
          orderBy: { nombre: 'asc' },
          take: 15,
        }),
    );
  };
