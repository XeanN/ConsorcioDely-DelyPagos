import type { BaseDatos } from '../db/prisma.js';
import type { BankProvider, Movimiento } from '../banco/tipos.js';
import type { BusEventos } from '../eventos/bus.js';
import { INCLUIR_VISTA, aVista, type MovimientoVista } from './vista.js';

interface Registro {
  info(datos: object, mensaje: string): void;
  warn(datos: object, mensaje: string): void;
  error(datos: object, mensaje: string): void;
}

const esDuplicado = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';

/**
 * Recibe los movimientos del banco (siempre vía `BankProvider`), los guarda una sola vez
 * y los publica en el bus para las pantallas en vivo.
 */
export class IngestaMovimientos {
  private cancelarSuscripcion: (() => void) | undefined;
  private cuentasConocidas = new Set<string>();

  constructor(
    private readonly db: BaseDatos,
    private readonly banco: BankProvider,
    private readonly bus: BusEventos,
    private readonly registro: Registro,
  ) {}

  /** Asegura que las cuentas del banco existan en la base (las necesitan los movimientos). */
  async prepararCuentas(): Promise<void> {
    const cuentas = await this.banco.listarCuentas();
    for (const c of cuentas) {
      await this.db.cuentaBancaria.upsert({
        where: { id: c.id },
        create: { id: c.id, banco: c.banco, numero: c.numero, cci: c.cci, moneda: c.moneda, tipo: c.tipo },
        update: {},
      });
      this.cuentasConocidas.add(c.id);
    }
  }

  /** Recupera lo que llegó mientras la API estuvo apagada (idempotente). */
  async sincronizar(desde: Date, hasta: Date = new Date()): Promise<number> {
    let nuevos = 0;
    for (const cuentaId of this.cuentasConocidas) {
      const movimientos = await this.banco.listarMovimientos(cuentaId, desde, hasta);
      for (const m of movimientos) if (await this.registrar(m)) nuevos++;
    }
    if (nuevos > 0) this.registro.info({ nuevos }, 'Movimientos recuperados del banco');
    return nuevos;
  }

  iniciar(): void {
    this.cancelarSuscripcion?.();
    this.cancelarSuscripcion = this.banco.suscribirMovimientos((m) => {
      void this.registrar(m).catch((error: unknown) =>
        this.registro.error({ err: error, idBanco: m.id }, 'No se pudo registrar el movimiento'),
      );
    });
    this.registro.info({ proveedor: this.banco.nombre }, 'Recepción de movimientos iniciada');
  }

  detener(): void {
    this.cancelarSuscripcion?.();
    this.cancelarSuscripcion = undefined;
  }

  /** Guarda el movimiento y lo publica. Devuelve null si ya existía. */
  async registrar(m: Movimiento): Promise<MovimientoVista | null> {
    if (m.tipo !== 'ABONO') return null;
    if (!this.cuentasConocidas.has(m.cuentaId)) {
      this.registro.warn({ cuentaId: m.cuentaId }, 'Movimiento de una cuenta desconocida; se ignora');
      return null;
    }
    try {
      const creado = await this.db.movimiento.create({
        data: {
          proveedor: this.banco.nombre,
          idBanco: m.id,
          cuentaId: m.cuentaId,
          fechaHora: m.fechaHora,
          tipo: m.tipo,
          monto: m.monto.toFixed(2),
          moneda: m.moneda,
          canal: m.canal,
          numeroOperacion: m.numeroOperacion,
          ordenanteNombre: m.ordenante?.nombre?.slice(0, 200) ?? null,
          ordenanteTipoDoc: m.ordenante?.tipoDoc ?? null,
          ordenanteNumeroDoc: m.ordenante?.numeroDoc ?? null,
          ordenanteBanco: m.ordenante?.bancoOrigen ?? null,
          ordenanteCuenta: m.ordenante?.cuentaOrigen ?? null,
          referencia: m.referencia?.slice(0, 200) ?? null,
        },
        include: INCLUIR_VISTA,
      });
      const vista = aVista(creado);
      this.bus.emit('movimiento.registrado', vista);
      return vista;
    } catch (error) {
      // El banco puede reenviar el mismo movimiento (reintentos, webhook + consulta).
      if (esDuplicado(error)) return null;
      throw error;
    }
  }
}
