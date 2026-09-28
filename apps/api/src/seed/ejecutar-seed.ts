import { hashearClave } from '../auth/claves.js';
import type { Config } from '../config.js';
import type { BaseDatos } from '../db/prisma.js';
import type { BankProvider } from '../banco/tipos.js';
import { CUENTAS_DELY, PROVEEDORES_SIMULADOS } from '../banco/mock/catalogo.js';
import { normalizarNombre } from '../conciliacion/normalizar.js';
import { Aleatorio } from '../simulacion/aleatorio.js';
import { generarDatosSemilla } from '../simulacion/datos-semilla.js';
import { generarCelular } from '../simulacion/documentos.js';
import { parsearUsuariosDemo } from './usuarios-demo.js';

const SEMILLA = 20260928;
const DIAS_HISTORIAL = 14;


export interface ResumenSeed {
  usuarios: number;
  cuentas: number;
  clientes: number;
  comprobantes: number;
  pedidos: number;
  proveedores: number;
  movimientos: number;
}

export async function ejecutarSeed(
  db: BaseDatos,
  banco: BankProvider,
  config: Config,
  ahora = new Date(),
): Promise<ResumenSeed> {
  if (config.NODE_ENV === 'production') {
    throw new Error('El seed borra todos los datos y no se ejecuta en producción.');
  }

  const usuariosDemo = parsearUsuariosDemo(config.SEED_USUARIOS_DEMO);
  const totalVentas = usuariosDemo.filter((u) => u.rol === 'VENTAS').length;
  const aleatorio = new Aleatorio(SEMILLA);
  const datos = generarDatosSemilla(aleatorio, ahora, Math.max(totalVentas, 1));

  // Nombres de tabla fijos (sin datos de entrada): no hay riesgo de inyección.
  await db.$executeRaw`TRUNCATE TABLE auditoria, notificaciones, alertas, conciliaciones,
    movimientos, validaciones_proveedor, proveedores, pedidos_caja, comprobantes,
    cuentas_origen_cliente, alias_cliente, clientes, cuentas_bancarias,
    suscripciones_webhook, sesiones, usuarios RESTART IDENTITY CASCADE`;

  // Usuarios de demo por rol (definidos en SEED_USUARIOS_DEMO, nunca en el código).
  const usuarios = [];
  for (const u of usuariosDemo) {
    usuarios.push(
      await db.usuario.create({
        data: {
          usuario: u.usuario,
          nombre: u.nombre,
          rol: u.rol,
          hashClave: await hashearClave(u.clave),
          telefono: u.rol === 'VENTAS' ? generarCelular(aleatorio) : null,
        },
      }),
    );
  }
  const vendedores = usuarios.filter((u) => u.rol === 'VENTAS');

  // Cuentas corporativas, leídas desde el proveedor bancario.
  const cuentas = await banco.listarCuentas();
  await db.cuentaBancaria.createMany({
    data: cuentas.map((c) => ({
      ...c,
      descripcion: CUENTAS_DELY.find((d) => d.id === c.id)?.descripcion ?? null,
    })),
  });

  // Clientes con sus alias y cuentas de origen conocidas.
  const idPorDocumento = new Map<string, string>();
  for (const c of datos.clientes) {
    const creado = await db.cliente.create({
      data: {
        tipoDoc: c.tipoDoc,
        numeroDoc: c.numeroDoc,
        nombre: c.nombre,
        tipo: c.tipo,
        telefono: c.telefono,
        correo: c.correo,
        vendedorId: c.vendedor === null ? null : (vendedores[c.vendedor]?.id ?? null),
        consentimientoNotificaciones: c.consentimiento,
        consentimientoEn: c.consentimiento ? ahora : null,
        alias: {
          create: c.alias.map((alias) => ({ alias, aliasNormalizado: normalizarNombre(alias) })),
        },
        cuentasOrigen: { create: c.cuentasOrigen },
      },
    });
    idPorDocumento.set(c.numeroDoc, creado.id);
  }

  await db.comprobante.createMany({
    data: datos.comprobantes.map(({ numeroDocCliente, total, saldoPendiente, ...c }) => ({
      ...c,
      clienteId: idPorDocumento.get(numeroDocCliente)!,
      total: total.toFixed(2),
      saldoPendiente: saldoPendiente.toFixed(2),
    })),
  });

  const cajero = usuarios.find((u) => u.rol === 'CAJA');
  await db.pedidoCaja.createMany({
    data: datos.pedidos.map((p) => ({
      tienda: p.tienda,
      caja: p.caja,
      monto: p.monto.toFixed(2),
      clienteId: p.numeroDocCliente ? (idPorDocumento.get(p.numeroDocCliente) ?? null) : null,
      creadoPorId: cajero?.id ?? null,
      creadoEn: p.creadoEn,
    })),
  });

  // Proveedores: la razón social registrada es el titular esperado.
  await db.proveedor.createMany({
    data: PROVEEDORES_SIMULADOS.map((p) => ({
      ruc: p.ruc,
      razonSocial: p.razonSocial,
      cci: p.cci,
      titularEsperado: p.razonSocial,
    })),
  });

  // Historial bancario de los últimos días (sin conciliar; el motor llega en F4).
  const desde = new Date(ahora.getTime() - DIAS_HISTORIAL * 24 * 60 * 60 * 1000);
  let totalMovimientos = 0;
  for (const cuenta of cuentas) {
    const movimientos = await banco.listarMovimientos(cuenta.id, desde, ahora);
    await db.movimiento.createMany({
      data: movimientos.map((m) => ({
        proveedor: banco.nombre,
        idBanco: m.id,
        cuentaId: m.cuentaId,
        fechaHora: m.fechaHora,
        tipo: m.tipo,
        monto: m.monto.toFixed(2),
        moneda: m.moneda,
        canal: m.canal,
        numeroOperacion: m.numeroOperacion,
        ordenanteNombre: m.ordenante?.nombre ?? null,
        ordenanteTipoDoc: m.ordenante?.tipoDoc ?? null,
        ordenanteNumeroDoc: m.ordenante?.numeroDoc ?? null,
        ordenanteBanco: m.ordenante?.bancoOrigen ?? null,
        ordenanteCuenta: m.ordenante?.cuentaOrigen ?? null,
        referencia: m.referencia,
        recibidoEn: m.fechaHora,
      })),
      skipDuplicates: true,
    });
    totalMovimientos += movimientos.length;
  }

  return {
    usuarios: usuarios.length,
    cuentas: cuentas.length,
    clientes: datos.clientes.length,
    comprobantes: datos.comprobantes.length,
    pedidos: datos.pedidos.length,
    proveedores: PROVEEDORES_SIMULADOS.length,
    movimientos: totalMovimientos,
  };
}
