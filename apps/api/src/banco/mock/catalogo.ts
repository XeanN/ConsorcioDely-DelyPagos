// Datos fijos del banco simulado. El seed los usa para que la base y el mock coincidan.
import { digitoVerificadorRuc } from '../../simulacion/documentos.js';
import type { Cuenta, TipoDocBanco } from '../tipos.js';

const ruc = (primeros10: string) => `${primeros10}${digitoVerificadorRuc(primeros10)}`;

export interface CuentaDelySimulada extends Cuenta {
  descripcion: string;
  saldoInicial: number;
  /** Peso relativo de movimientos que recibe. */
  peso: number;
}

export const CUENTAS_DELY: readonly CuentaDelySimulada[] = [
  {
    id: 'bcp-pen-01',
    banco: 'BCP',
    numero: '191-2045871-0-38',
    cci: '00219100204587103854',
    moneda: 'PEN',
    tipo: 'CORRIENTE',
    descripcion: 'BCP Soles — Recaudación',
    saldoInicial: 185430.5,
    peso: 60,
  },
  {
    id: 'bcp-usd-01',
    banco: 'BCP',
    numero: '191-2045872-1-12',
    cci: '00219100204587211252',
    moneda: 'USD',
    tipo: 'CORRIENTE',
    descripcion: 'BCP Dólares',
    saldoInicial: 42300,
    peso: 12,
  },
  {
    id: 'ibk-pen-01',
    banco: 'INTERBANK',
    numero: '200-3001234567',
    cci: '00320000300123456738',
    moneda: 'PEN',
    tipo: 'CORRIENTE',
    descripcion: 'Interbank Soles',
    saldoInicial: 67815.2,
    peso: 28,
  },
];

export type EscenarioValidacion = 'COINCIDE' | 'FRAUDE' | 'NO_DISPONIBLE';

export interface ProveedorSimulado {
  ruc: string;
  /** Razón social registrada por Dely. */
  razonSocial: string;
  cci: string;
  banco: string;
  /** Titular que devuelve el banco al validar el CCI. */
  titularBanco: string;
  tipoDocTitular: TipoDocBanco;
  numeroDocTitular: string;
  escenario: EscenarioValidacion;
}

export const PROVEEDORES_SIMULADOS: readonly ProveedorSimulado[] = [
  {
    ruc: ruc('2060123451'),
    razonSocial: 'EMPAQUES Y ENVASES DEL PERU S.A.C.',
    cci: '00219300123456789012',
    banco: 'BCP',
    titularBanco: 'EMPAQUES Y ENVASES DEL PERU S.A.C.',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2060123451'),
    escenario: 'COINCIDE',
  },
  {
    ruc: ruc('2045678123'),
    razonSocial: 'TRANSPORTES RAPIDO NORTE S.R.L.',
    cci: '01110300020045678123',
    banco: 'BBVA',
    titularBanco: 'TRANSPORTES RAPIDO NORTE SRL',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2045678123'),
    escenario: 'COINCIDE',
  },
  {
    ruc: ruc('2010098765'),
    razonSocial: 'IMPORTADORA ANDINA DE ALIMENTOS S.A.',
    cci: '00310000300987654321',
    banco: 'INTERBANK',
    titularBanco: 'IMPORTADORA ANDINA DE ALIMENTOS SA',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2010098765'),
    escenario: 'COINCIDE',
  },
  {
    ruc: ruc('2055512340'),
    razonSocial: 'MOLINERA SANTA ROSA S.A.C.',
    cci: '00917000055512340099',
    banco: 'SCOTIABANK',
    titularBanco: 'MOLINERA STA ROSA SAC',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2055512340'),
    escenario: 'COINCIDE',
  },
  {
    ruc: ruc('2048765432'),
    razonSocial: 'SERVICIOS LOGISTICOS CUSCO E.I.R.L.',
    cci: '00228500487654320017',
    banco: 'BCP',
    titularBanco: 'SERVICIOS LOGISTICOS CUSCO EIRL',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2048765432'),
    escenario: 'COINCIDE',
  },
  {
    // Simula un intento de fraude: el CCI registrado pertenece a una persona natural.
    ruc: ruc('2060987654'),
    razonSocial: 'INDUSTRIAS ALIMENTARIAS DEL SUR S.A.C.',
    cci: '01119300045612378945',
    banco: 'BBVA',
    titularBanco: 'JHON ALEX PAREDES SOTO',
    tipoDocTitular: 'DNI',
    numeroDocTitular: '46123987',
    escenario: 'FRAUDE',
  },
  {
    // El banco no responde al validar este CCI.
    ruc: ruc('2050321987'),
    razonSocial: 'DISTRIBUIDORA GRAFICA LIMA S.A.C.',
    cci: '03800100503219870011',
    banco: 'BANBIF',
    titularBanco: 'DISTRIBUIDORA GRAFICA LIMA S.A.C.',
    tipoDocTitular: 'RUC',
    numeroDocTitular: ruc('2050321987'),
    escenario: 'NO_DISPONIBLE',
  },
];
