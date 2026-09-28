import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CciInvalidoError, CuentaNoEncontradaError, ServicioBancarioNoDisponibleError } from '../errores.js';
import type { Movimiento } from '../tipos.js';
import { CUENTAS_DELY, PROVEEDORES_SIMULADOS } from './catalogo.js';
import { MockBankProvider } from './mock-bank-provider.js';

const AHORA = new Date('2026-09-28T16:00:00Z'); // 11:00 en Lima

function crear(opciones: ConstructorParameters<typeof MockBankProvider>[0] = {}) {
  return new MockBankProvider({ semilla: 42, ahora: () => AHORA, ...opciones });
}

describe('MockBankProvider — cuentas y saldos', () => {
  it('expone las 3 cuentas de Dely (BCP PEN, BCP USD, Interbank PEN)', async () => {
    const cuentas = await crear().listarCuentas();
    expect(cuentas.map((c) => [c.banco, c.moneda])).toEqual([
      ['BCP', 'PEN'],
      ['BCP', 'USD'],
      ['INTERBANK', 'PEN'],
    ]);
    for (const c of cuentas) expect(c.cci).toMatch(/^\d{20}$/);
  });

  it('devuelve el saldo en la moneda de la cuenta', async () => {
    const saldo = await crear().obtenerSaldo('bcp-usd-01');
    expect(saldo).toMatchObject({ cuentaId: 'bcp-usd-01', moneda: 'USD', disponible: 42300 });
  });

  it('lanza error con una cuenta inexistente', async () => {
    await expect(crear().obtenerSaldo('no-existe')).rejects.toBeInstanceOf(CuentaNoEncontradaError);
  });
});

describe('MockBankProvider — historial', () => {
  it('genera 14 días de abonos en horario comercial de Lima y nunca en el futuro', async () => {
    const banco = crear();
    const desde = new Date(AHORA.getTime() - 15 * 24 * 3600 * 1000);
    const movimientos = (
      await Promise.all(CUENTAS_DELY.map((c) => banco.listarMovimientos(c.id, desde, AHORA)))
    ).flat();

    expect(movimientos.length).toBeGreaterThan(300);
    for (const m of movimientos) {
      expect(m.fechaHora.getTime()).toBeLessThanOrEqual(AHORA.getTime());
      const horaLima = (m.fechaHora.getUTCHours() + 24 - 5) % 24;
      expect(horaLima).toBeGreaterThanOrEqual(8);
      expect(horaLima).toBeLessThanOrEqual(19);
      expect(m.tipo).toBe('ABONO');
      expect(m.monto).toBeGreaterThan(0);
    }
  });

  it('filtra por rango de fechas', async () => {
    const banco = crear();
    const desde = new Date(AHORA.getTime() - 24 * 3600 * 1000);
    const movimientos = await banco.listarMovimientos('bcp-pen-01', desde, AHORA);
    for (const m of movimientos) expect(m.fechaHora >= desde && m.fechaHora <= AHORA).toBe(true);
  });

  it('es reproducible con la misma semilla', async () => {
    const desde = new Date(0);
    const a = await crear().listarMovimientos('bcp-pen-01', desde, AHORA);
    const b = await crear().listarMovimientos('bcp-pen-01', desde, AHORA);
    expect(a).toEqual(b);
  });

  it('usa canales coherentes con la moneda: sin Yape ni Plin en dólares', async () => {
    const movimientos = await crear().listarMovimientos('bcp-usd-01', new Date(0), AHORA);
    expect(movimientos.length).toBeGreaterThan(0);
    for (const m of movimientos) {
      expect(m.moneda).toBe('USD');
      expect(['YAPE', 'PLIN']).not.toContain(m.canal);
    }
  });

  it('Yape y Plin no traen documento ni cuenta de origen', async () => {
    const movimientos = await crear().listarMovimientos('bcp-pen-01', new Date(0), AHORA);
    const billeteras = movimientos.filter((m) => m.canal === 'YAPE' || m.canal === 'PLIN');
    expect(billeteras.length).toBeGreaterThan(0);
    for (const m of billeteras) {
      expect(m.ordenante?.numeroDoc).toBeNull();
      expect(m.ordenante?.cuentaOrigen).toBeNull();
      expect(m.monto).toBeLessThanOrEqual(2000);
    }
  });

  it('las interbancarias traen CCI de origen de 20 dígitos', async () => {
    const movimientos = await crear().listarMovimientos('bcp-pen-01', new Date(0), AHORA);
    const interbancarias = movimientos.filter((m) => m.canal === 'INTERBANCARIA');
    expect(interbancarias.length).toBeGreaterThan(0);
    for (const m of interbancarias) expect(m.ordenante?.cuentaOrigen).toMatch(/^\d{20}$/);
  });
});

describe('MockBankProvider — validarCuenta', () => {
  it('rechaza un CCI con formato inválido antes de consultar', async () => {
    await expect(crear().validarCuenta('123')).rejects.toBeInstanceOf(CciInvalidoError);
    await expect(crear().validarCuenta('0021930012345678901X')).rejects.toBeInstanceOf(
      CciInvalidoError,
    );
  });

  it('acepta el CCI con guiones o espacios', async () => {
    const proveedor = PROVEEDORES_SIMULADOS[0]!;
    const conGuiones = `${proveedor.cci.slice(0, 3)}-${proveedor.cci.slice(3, 6)} ${proveedor.cci.slice(6)}`;
    const resultado = await crear().validarCuenta(conGuiones);
    expect(resultado).toMatchObject({ valida: true, titular: proveedor.titularBanco });
  });

  it('incluye un caso de fraude: el titular del CCI no es la empresa registrada', async () => {
    const fraude = PROVEEDORES_SIMULADOS.find((p) => p.escenario === 'FRAUDE')!;
    const resultado = await crear().validarCuenta(fraude.cci);
    expect(resultado.valida).toBe(true);
    expect(resultado.titular).not.toBe(fraude.razonSocial);
    expect(resultado.tipoDocTitular).toBe('DNI');
  });

  it('simula el servicio del banco caído', async () => {
    const caido = PROVEEDORES_SIMULADOS.find((p) => p.escenario === 'NO_DISPONIBLE')!;
    await expect(crear().validarCuenta(caido.cci)).rejects.toBeInstanceOf(
      ServicioBancarioNoDisponibleError,
    );
  });

  it('marca como no válida una cuenta que el banco no encuentra', async () => {
    const resultado = await crear().validarCuenta('00200000000000000000');
    expect(resultado).toMatchObject({ valida: false, titular: null });
  });
});

describe('MockBankProvider — simulador en vivo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emite abonos entre el intervalo mínimo y máximo mientras hay suscriptores', async () => {
    const banco = crear({ intervaloMinS: 10, intervaloMaxS: 40 });
    const recibidos: Movimiento[] = [];
    const cancelar = banco.suscribirMovimientos((m) => recibidos.push(m));

    await vi.advanceTimersByTimeAsync(9_999);
    expect(recibidos).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // En 10 minutos, con intervalos de 10–40 s, llegan entre 15 y 60 abonos.
    expect(recibidos.length).toBeGreaterThanOrEqual(15);
    expect(recibidos.length).toBeLessThanOrEqual(61);

    cancelar();
    const total = recibidos.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(recibidos).toHaveLength(total);
  });

  it('un suscriptor con error no afecta a los demás', async () => {
    const banco = crear({ intervaloMinS: 1, intervaloMaxS: 1 });
    const recibidos: Movimiento[] = [];
    banco.suscribirMovimientos(() => {
      throw new Error('falla');
    });
    banco.suscribirMovimientos((m) => recibidos.push(m));
    await vi.advanceTimersByTimeAsync(3_500);
    expect(recibidos.length).toBe(3);
    banco.detener();
  });

  it('usa los pagos esperados que entrega la aplicación', async () => {
    const banco = crear({
      intervaloMinS: 1,
      intervaloMaxS: 1,
      probabilidadPagoEsperado: 1,
      obtenerPagosEsperados: async () => [
        { monto: 350, moneda: 'PEN', nombre: 'ROSA HUAMAN', referencia: 'PEDIDO 12' },
      ],
    });
    const recibidos: Movimiento[] = [];
    banco.suscribirMovimientos((m) => recibidos.push(m));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recibidos[0]).toMatchObject({ monto: 350, moneda: 'PEN', referencia: 'PEDIDO 12' });
    expect(recibidos[0]!.ordenante?.nombre).toBe('ROSA HUAMAN');
    banco.detener();
  });

  it('sigue generando abonos si la aplicación no entrega pagos esperados', async () => {
    const banco = crear({
      intervaloMinS: 1,
      intervaloMaxS: 1,
      probabilidadPagoEsperado: 1,
      obtenerPagosEsperados: async () => {
        throw new Error('base de datos caída');
      },
    });
    const recibidos: Movimiento[] = [];
    banco.suscribirMovimientos((m) => recibidos.push(m));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(recibidos).toHaveLength(2);
    banco.detener();
  });
});

describe('MockBankProvider — inyectarMovimiento', () => {
  it('registra el abono, actualiza el saldo y lo emite', async () => {
    const banco = crear();
    const recibidos: Movimiento[] = [];
    const cancelar = banco.suscribirMovimientos((m) => recibidos.push(m));
    const antes = (await banco.obtenerSaldo('bcp-pen-01')).disponible;

    const m = banco.inyectarMovimiento({
      cuentaId: 'bcp-pen-01',
      canal: 'YAPE',
      pago: { monto: 350, moneda: 'PEN', nombre: 'JUAN C QUISPE M' },
    });

    expect(m).toMatchObject({ canal: 'YAPE', monto: 350 });
    expect((await banco.obtenerSaldo('bcp-pen-01')).disponible).toBeCloseTo(antes + 350, 2);
    expect(recibidos).toHaveLength(1);
    cancelar();
  });

  it('cambia a transferencia si el monto supera el tope de Yape', () => {
    const m = crear().inyectarMovimiento({
      cuentaId: 'bcp-pen-01',
      canal: 'YAPE',
      pago: { monto: 8500, moneda: 'PEN' },
    });
    expect(m.canal).toBe('TRANSFERENCIA');
  });
});
