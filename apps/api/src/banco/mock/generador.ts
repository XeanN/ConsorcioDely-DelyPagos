import type { Aleatorio } from '../../simulacion/aleatorio.js';
import {
  generarFamiliar,
  generarPersona,
  generarRazonSocial,
  variarNombrePersona,
  variarRazonSocial,
} from '../../simulacion/datos-peru.js';
import {
  CODIGO_BANCO,
  generarCci,
  generarCuentaBcp,
  generarDni,
  generarRuc,
} from '../../simulacion/documentos.js';
import type { CanalBanco, Cuenta, Movimiento, Ordenante, TipoDocBanco } from '../tipos.js';

/**
 * Pago que el simulador puede "hacer llegar" (pedido en caja o factura pendiente),
 * para que la demo muestre conciliaciones. Lo entrega la aplicación, no el banco.
 */
export interface PagoEsperado {
  monto: number;
  moneda: 'PEN' | 'USD';
  nombre?: string;
  tipoDoc?: TipoDocBanco;
  numeroDoc?: string;
  referencia?: string;
  cuentaOrigen?: string;
  bancoOrigen?: string;
}

export interface SolicitudMovimiento {
  cuenta: Cuenta;
  fechaHora: Date;
  secuencia: number;
  canal?: CanalBanco;
  pago?: PagoEsperado;
}

/** Límite práctico de Yape/Plin para simular; montos mayores llegan por transferencia. */
const TOPE_BILLETERA = 2000;
const OTROS_BANCOS = ['INTERBANK', 'BBVA', 'SCOTIABANK', 'BANBIF', 'PICHINCHA'] as const;

function elegirCanal(a: Aleatorio, cuenta: Cuenta): CanalBanco {
  if (cuenta.moneda === 'USD') {
    return a.elegirPonderado<CanalBanco>([
      ['TRANSFERENCIA', 60],
      ['INTERBANCARIA', 30],
      ['DEPOSITO_AGENCIA', 10],
    ]);
  }
  return a.elegirPonderado<CanalBanco>([
    ['YAPE', cuenta.banco === 'BCP' ? 35 : 0],
    ['PLIN', cuenta.banco === 'BCP' ? 10 : 30],
    ['TRANSFERENCIA', 25],
    ['INTERBANCARIA', 18],
    ['DEPOSITO_AGENCIA', 12],
  ]);
}

function montoAleatorio(a: Aleatorio, canal: CanalBanco, moneda: 'PEN' | 'USD'): number {
  if (moneda === 'USD') return a.monto(150, 12000);
  switch (canal) {
    case 'YAPE':
    case 'PLIN':
      return a.elegirPonderado<number>([
        [a.entero(1, 30) * 5, 5],
        [a.monto(10, 500), 4],
        [a.monto(500, TOPE_BILLETERA), 1],
      ]);
    case 'DEPOSITO_AGENCIA':
      return a.monto(100, 8000);
    default:
      return a.elegirPonderado<number>([
        [a.monto(150, 2000), 4],
        [a.monto(2000, 12000), 4],
        [a.monto(12000, 35000), 1],
      ]);
  }
}

function ordenanteAleatorio(a: Aleatorio, canal: CanalBanco, cuenta: Cuenta): Ordenante | null {
  const esEmpresa =
    (canal === 'TRANSFERENCIA' || canal === 'INTERBANCARIA') && a.probabilidad(0.45);
  const persona = generarPersona(a);
  // A veces paga un familiar del cliente.
  const pagador = a.probabilidad(0.1) ? generarFamiliar(a, persona) : persona;
  const nombre = esEmpresa
    ? variarRazonSocial(a, generarRazonSocial(a))
    : variarNombrePersona(a, pagador);

  switch (canal) {
    case 'YAPE':
      return { nombre, tipoDoc: null, numeroDoc: null, bancoOrigen: 'BCP', cuentaOrigen: null };
    case 'PLIN':
      return {
        nombre,
        tipoDoc: null,
        numeroDoc: null,
        bancoOrigen: a.elegir(['INTERBANK', 'BBVA', 'SCOTIABANK']),
        cuentaOrigen: null,
      };
    case 'DEPOSITO_AGENCIA':
      return a.probabilidad(0.5)
        ? { nombre, tipoDoc: null, numeroDoc: null, bancoOrigen: null, cuentaOrigen: null }
        : null;
    case 'TRANSFERENCIA':
    case 'INTERBANCARIA': {
      const conDocumento = a.probabilidad(canal === 'INTERBANCARIA' ? 0.7 : 0.4);
      const tipoDoc: TipoDocBanco | null = conDocumento ? (esEmpresa ? 'RUC' : 'DNI') : null;
      const numeroDoc =
        tipoDoc === 'RUC' ? generarRuc(a, '20') : tipoDoc === 'DNI' ? generarDni(a) : null;
      const bancoOrigen = canal === 'TRANSFERENCIA' ? cuenta.banco : a.elegir(OTROS_BANCOS);
      return {
        nombre,
        tipoDoc,
        numeroDoc,
        bancoOrigen,
        cuentaOrigen: cuentaOrigenAleatoria(a, bancoOrigen, canal),
      };
    }
  }
}

function cuentaOrigenAleatoria(a: Aleatorio, banco: string, canal: CanalBanco): string {
  if (canal === 'INTERBANCARIA') {
    const entidad = (banco in CODIGO_BANCO ? banco : 'BBVA') as keyof typeof CODIGO_BANCO;
    return generarCci(a, entidad);
  }
  return banco === 'BCP' ? generarCuentaBcp(a) : `200-3${a.digitos(9)}`;
}

function referenciaAleatoria(a: Aleatorio, canal: CanalBanco): string | null {
  if (a.probabilidad(0.5)) return null;
  if (canal === 'YAPE' || canal === 'PLIN') {
    return a.elegir(['pago', 'pedido', 'gracias', 'mercaderia', `pedido ${a.entero(1, 40)}`]);
  }
  return a.elegir(['PAGO', 'PAGO PROVEEDOR', 'VARIOS', 'CANCELACION', 'ABONO CTA']);
}

function numeroOperacion(a: Aleatorio, canal: CanalBanco): string {
  return canal === 'YAPE' || canal === 'PLIN' ? a.digitos(8) : a.digitos(a.entero(6, 10));
}

/** Construye un abono realista. Si recibe un pago esperado, el movimiento lo refleja. */
export function generarMovimiento(a: Aleatorio, s: SolicitudMovimiento): Movimiento {
  const { cuenta, pago } = s;
  let canal = s.canal ?? elegirCanal(a, cuenta);
  if (pago && (canal === 'YAPE' || canal === 'PLIN') && pago.monto > TOPE_BILLETERA) {
    canal = 'TRANSFERENCIA';
  }
  if (cuenta.moneda === 'USD' && (canal === 'YAPE' || canal === 'PLIN')) canal = 'TRANSFERENCIA';

  let ordenante = ordenanteAleatorio(a, canal, cuenta);
  if (pago) {
    const base: Ordenante = ordenante ?? {
      nombre: null,
      tipoDoc: null,
      numeroDoc: null,
      bancoOrigen: null,
      cuentaOrigen: null,
    };
    const conDocumento = canal === 'TRANSFERENCIA' || canal === 'INTERBANCARIA';
    ordenante = {
      nombre: pago.nombre ?? base.nombre,
      tipoDoc: conDocumento ? (pago.tipoDoc ?? base.tipoDoc) : null,
      numeroDoc: conDocumento ? (pago.numeroDoc ?? base.numeroDoc) : null,
      bancoOrigen: pago.bancoOrigen ?? base.bancoOrigen,
      cuentaOrigen: conDocumento ? (pago.cuentaOrigen ?? base.cuentaOrigen) : null,
    };
  }

  const fecha = s.fechaHora;
  return {
    id: `MCK-${cuenta.id}-${fecha.getTime()}-${s.secuencia}`,
    cuentaId: cuenta.id,
    fechaHora: fecha,
    tipo: 'ABONO',
    monto: pago?.monto ?? montoAleatorio(a, canal, cuenta.moneda),
    moneda: cuenta.moneda,
    canal,
    numeroOperacion: numeroOperacion(a, canal),
    ordenante,
    referencia: pago ? (pago.referencia ?? null) : referenciaAleatoria(a, canal),
  };
}
