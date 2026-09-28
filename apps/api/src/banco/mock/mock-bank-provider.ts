import { Aleatorio } from '../../simulacion/aleatorio.js';
import { exigirCciValido } from '../cci.js';
import { CuentaNoEncontradaError, ServicioBancarioNoDisponibleError } from '../errores.js';
import type { BankProvider, CanalBanco, Cuenta, Movimiento, Saldo, ValidacionCuenta } from '../tipos.js';
import { CUENTAS_DELY, PROVEEDORES_SIMULADOS, type CuentaDelySimulada } from './catalogo.js';
import { generarMovimiento, type PagoEsperado } from './generador.js';

export interface OpcionesMock {
  semilla?: number;
  intervaloMinS?: number;
  intervaloMaxS?: number;
  /** Días de historial generados al iniciar (para posición de caja y el seed). */
  historialDias?: number;
  ahora?: () => Date;
  /** Pagos que la aplicación espera (pedidos, facturas). El simulador los usa a veces. */
  obtenerPagosEsperados?: () => Promise<PagoEsperado[]>;
  probabilidadPagoEsperado?: number;
}

export interface MovimientoInyectado {
  cuentaId?: string;
  canal?: CanalBanco;
  pago?: PagoEsperado;
}

type Suscriptor = (m: Movimiento) => void;

/** Lima está en UTC-5 todo el año (sin horario de verano). */
const DESFASE_LIMA_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Banco simulado para la demostración. Genera abonos realistas cada
 * `intervaloMinS`–`intervaloMaxS` segundos mientras haya suscriptores.
 */
export class MockBankProvider implements BankProvider {
  readonly nombre = 'mock';

  private readonly aleatorio: Aleatorio;
  private readonly ahora: () => Date;
  private readonly intervaloMinS: number;
  private readonly intervaloMaxS: number;
  private readonly obtenerPagosEsperados?: () => Promise<PagoEsperado[]>;
  private readonly probabilidadPagoEsperado: number;

  private readonly historial = new Map<string, Movimiento[]>();
  private readonly saldos = new Map<string, number>();
  private readonly suscriptores = new Set<Suscriptor>();
  private temporizador: ReturnType<typeof setTimeout> | undefined;
  private secuencia = 0;

  constructor(opciones: OpcionesMock = {}) {
    this.aleatorio = new Aleatorio(opciones.semilla ?? Date.now());
    this.ahora = opciones.ahora ?? (() => new Date());
    this.intervaloMinS = opciones.intervaloMinS ?? 10;
    this.intervaloMaxS = Math.max(opciones.intervaloMaxS ?? 40, this.intervaloMinS);
    this.obtenerPagosEsperados = opciones.obtenerPagosEsperados;
    this.probabilidadPagoEsperado = opciones.probabilidadPagoEsperado ?? 0.6;

    for (const cuenta of CUENTAS_DELY) {
      this.historial.set(cuenta.id, []);
      this.saldos.set(cuenta.id, cuenta.saldoInicial);
    }
    this.generarHistorial(opciones.historialDias ?? 14);
  }

  async listarCuentas(): Promise<Cuenta[]> {
    return CUENTAS_DELY.map(({ id, banco, numero, cci, moneda, tipo }) => ({
      id,
      banco,
      numero,
      cci,
      moneda,
      tipo,
    }));
  }

  async obtenerSaldo(cuentaId: string): Promise<Saldo> {
    const cuenta = this.buscarCuenta(cuentaId);
    const disponible = Math.round((this.saldos.get(cuentaId) ?? 0) * 100) / 100;
    return {
      cuentaId,
      disponible,
      contable: disponible,
      moneda: cuenta.moneda,
      actualizadoEn: this.ahora(),
    };
  }

  async listarMovimientos(cuentaId: string, desde: Date, hasta: Date): Promise<Movimiento[]> {
    this.buscarCuenta(cuentaId);
    return (this.historial.get(cuentaId) ?? [])
      .filter((m) => m.fechaHora >= desde && m.fechaHora <= hasta)
      .map((m) => structuredClone(m));
  }

  async validarCuenta(cci: string): Promise<ValidacionCuenta> {
    const limpio = exigirCciValido(cci);
    const registro = PROVEEDORES_SIMULADOS.find((p) => p.cci === limpio);
    if (registro?.escenario === 'NO_DISPONIBLE') {
      throw new ServicioBancarioNoDisponibleError('validarCuenta');
    }
    if (!registro) {
      return {
        cci: limpio,
        valida: false,
        titular: null,
        tipoDocTitular: null,
        numeroDocTitular: null,
        banco: null,
      };
    }
    return {
      cci: limpio,
      valida: true,
      titular: registro.titularBanco,
      tipoDocTitular: registro.tipoDocTitular,
      numeroDocTitular: registro.numeroDocTitular,
      banco: registro.banco,
    };
  }

  suscribirMovimientos(cb: Suscriptor): () => void {
    this.suscriptores.add(cb);
    if (this.suscriptores.size === 1) this.programarSiguiente();
    return () => {
      this.suscriptores.delete(cb);
      if (this.suscriptores.size === 0) this.cancelarTemporizador();
    };
  }

  /** Inserta un movimiento a pedido (modo presentación y pruebas). */
  inyectarMovimiento(solicitud: MovimientoInyectado = {}): Movimiento {
    const cuenta = solicitud.cuentaId
      ? this.buscarCuenta(solicitud.cuentaId)
      : this.cuentaParaMoneda(solicitud.pago?.moneda);
    const movimiento = generarMovimiento(this.aleatorio, {
      cuenta,
      fechaHora: this.ahora(),
      secuencia: ++this.secuencia,
      canal: solicitud.canal,
      pago: solicitud.pago,
    });
    this.registrar(movimiento);
    return structuredClone(movimiento);
  }

  /** Detiene el simulador y elimina las suscripciones. */
  detener(): void {
    this.cancelarTemporizador();
    this.suscriptores.clear();
  }

  // ─── Internos ────────────────────────────────────────────

  private buscarCuenta(cuentaId: string): CuentaDelySimulada {
    const cuenta = CUENTAS_DELY.find((c) => c.id === cuentaId);
    if (!cuenta) throw new CuentaNoEncontradaError(cuentaId);
    return cuenta;
  }

  private cuentaParaMoneda(moneda?: 'PEN' | 'USD'): CuentaDelySimulada {
    const candidatas = CUENTAS_DELY.filter((c) => !moneda || c.moneda === moneda);
    return this.aleatorio.elegirPonderado(candidatas.map((c) => [c, c.peso] as const));
  }

  private registrar(movimiento: Movimiento): void {
    this.historial.get(movimiento.cuentaId)!.push(movimiento);
    this.saldos.set(
      movimiento.cuentaId,
      (this.saldos.get(movimiento.cuentaId) ?? 0) + movimiento.monto,
    );
    for (const cb of this.suscriptores) {
      try {
        cb(structuredClone(movimiento));
      } catch {
        // Un suscriptor con error no debe detener el simulador ni a los demás.
      }
    }
  }

  private programarSiguiente(): void {
    const esperaMs = this.aleatorio.entero(this.intervaloMinS, this.intervaloMaxS) * 1000;
    this.temporizador = setTimeout(() => {
      void this.emitirAleatorio().finally(() => {
        if (this.suscriptores.size > 0) this.programarSiguiente();
      });
    }, esperaMs);
    this.temporizador.unref?.();
  }

  private cancelarTemporizador(): void {
    if (this.temporizador) clearTimeout(this.temporizador);
    this.temporizador = undefined;
  }

  private async emitirAleatorio(): Promise<void> {
    let pago: PagoEsperado | undefined;
    if (this.obtenerPagosEsperados && this.aleatorio.probabilidad(this.probabilidadPagoEsperado)) {
      try {
        const esperados = await this.obtenerPagosEsperados();
        if (esperados.length > 0) pago = this.aleatorio.elegir(esperados);
      } catch {
        // Si la aplicación no responde, el banco sigue generando abonos aleatorios.
      }
    }
    if (this.suscriptores.size === 0) return;
    this.inyectarMovimiento({ pago });
  }

  /** Historial de días previos en horario comercial (08:00–19:30, hora de Lima). */
  private generarHistorial(dias: number): void {
    const ahora = this.ahora().getTime();
    const hoyLima = Math.floor((ahora - DESFASE_LIMA_MS) / DIA_MS) * DIA_MS + DESFASE_LIMA_MS;
    const generados: Movimiento[] = [];

    for (let d = dias; d >= 0; d--) {
      const inicioDia = hoyLima - d * DIA_MS;
      const esDomingo = new Date(inicioDia - DESFASE_LIMA_MS).getUTCDay() === 0;
      const cantidad = esDomingo ? this.aleatorio.entero(8, 18) : this.aleatorio.entero(35, 60);
      for (let i = 0; i < cantidad; i++) {
        const minuto = this.aleatorio.entero(8 * 60, 19 * 60 + 30);
        const fecha = new Date(inicioDia + minuto * 60_000 + this.aleatorio.entero(0, 59) * 1000);
        if (fecha.getTime() > ahora) continue;
        generados.push(
          generarMovimiento(this.aleatorio, {
            cuenta: this.cuentaParaMoneda(),
            fechaHora: fecha,
            secuencia: ++this.secuencia,
          }),
        );
      }
    }

    generados.sort((x, y) => x.fechaHora.getTime() - y.fechaHora.getTime());
    for (const m of generados) this.historial.get(m.cuentaId)!.push(m);
  }
}
