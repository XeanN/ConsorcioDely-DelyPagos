// Modelos del contrato bancario PROVISIONAL (docs/contrato-api-bancaria.yaml).
// No es la API oficial de ningún banco: cada adaptador traduce su banco a estos tipos.

export type MonedaBanco = 'PEN' | 'USD';
export type CanalBanco = 'TRANSFERENCIA' | 'INTERBANCARIA' | 'YAPE' | 'PLIN' | 'DEPOSITO_AGENCIA';
export type TipoDocBanco = 'DNI' | 'RUC' | 'CE';

export const CANALES: readonly CanalBanco[] = [
  'TRANSFERENCIA',
  'INTERBANCARIA',
  'YAPE',
  'PLIN',
  'DEPOSITO_AGENCIA',
];

export interface Cuenta {
  id: string;
  banco: string;
  numero: string;
  cci: string;
  moneda: MonedaBanco;
  tipo: 'CORRIENTE' | 'AHORROS';
}

export interface Saldo {
  cuentaId: string;
  disponible: number;
  contable: number;
  moneda: MonedaBanco;
  actualizadoEn: Date;
}

export interface Ordenante {
  nombre: string | null;
  tipoDoc: TipoDocBanco | null;
  numeroDoc: string | null;
  bancoOrigen: string | null;
  /** Número de cuenta o CCI de origen. Puede no llegar (p. ej. Yape y Plin). */
  cuentaOrigen: string | null;
}

export interface Movimiento {
  id: string;
  cuentaId: string;
  fechaHora: Date;
  tipo: 'ABONO' | 'CARGO';
  monto: number;
  moneda: MonedaBanco;
  canal: CanalBanco;
  numeroOperacion: string;
  ordenante: Ordenante | null;
  referencia: string | null;
}

export interface ValidacionCuenta {
  cci: string;
  /** false si el banco no encuentra la cuenta. */
  valida: boolean;
  titular: string | null;
  tipoDocTitular: TipoDocBanco | null;
  numeroDocTitular: string | null;
  banco: string | null;
}

/** Punto único de acceso al banco. Ningún otro módulo hace HTTP bancario. */
export interface BankProvider {
  readonly nombre: string;
  listarCuentas(): Promise<Cuenta[]>;
  obtenerSaldo(cuentaId: string): Promise<Saldo>;
  listarMovimientos(cuentaId: string, desde: Date, hasta: Date): Promise<Movimiento[]>;
  /** Titular de una cuenta destino. Lanza `CciInvalidoError` si el formato es incorrecto. */
  validarCuenta(cci: string): Promise<ValidacionCuenta>;
  /** Push (webhook) o polling interno. Devuelve la función para cancelar la suscripción. */
  suscribirMovimientos(cb: (m: Movimiento) => void): () => void;
}
