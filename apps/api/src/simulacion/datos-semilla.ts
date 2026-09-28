import type { Aleatorio } from './aleatorio.js';
import {
  generarPersona,
  generarRazonSocial,
  nombreCompleto,
  variarNombrePersona,
  variarRazonSocial,
  generarFamiliar,
} from './datos-peru.js';
import { generarCelular, generarCuentaBcp, generarDni, generarRuc } from './documentos.js';

export type TipoClienteSemilla = 'MAYORISTA' | 'MINORISTA' | 'CONSUMIDOR_FINAL';
export type EstadoComprobanteSemilla = 'PENDIENTE' | 'PARCIAL' | 'PAGADO';

export interface ClienteSemilla {
  tipoDoc: 'DNI' | 'RUC';
  numeroDoc: string;
  nombre: string;
  tipo: TipoClienteSemilla;
  telefono: string;
  correo: string | null;
  consentimiento: boolean;
  /** Índice del vendedor asignado (0..n-1) o null. */
  vendedor: number | null;
  alias: string[];
  cuentasOrigen: { banco: string; cuenta: string }[];
}

export interface ComprobanteSemilla {
  tipo: 'FACTURA' | 'BOLETA';
  serie: string;
  numero: number;
  numeroDocCliente: string;
  fechaEmision: Date;
  fechaVencimiento: Date;
  total: number;
  saldoPendiente: number;
  moneda: 'PEN' | 'USD';
  estado: EstadoComprobanteSemilla;
}

export interface PedidoSemilla {
  tienda: string;
  caja: string;
  monto: number;
  numeroDocCliente: string | null;
  creadoEn: Date;
}

export interface DatosSemilla {
  clientes: ClienteSemilla[];
  comprobantes: ComprobanteSemilla[];
  pedidos: PedidoSemilla[];
}

const DIA_MS = 24 * 60 * 60 * 1000;
const redondear = (n: number) => Math.round(n * 100) / 100;

function correoDe(nombre: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  // Dominio reservado para ejemplos (RFC 2606): nunca llega a un buzón real.
  return `contacto@${slug}.example.com`;
}

function estadoSegunAntiguedad(a: Aleatorio, dias: number): EstadoComprobanteSemilla {
  if (dias > 60) return a.elegirPonderado([['PAGADO', 60], ['PARCIAL', 15], ['PENDIENTE', 25]]);
  if (dias > 30) return a.elegirPonderado([['PAGADO', 40], ['PARCIAL', 20], ['PENDIENTE', 40]]);
  return a.elegirPonderado([['PAGADO', 15], ['PARCIAL', 15], ['PENDIENTE', 70]]);
}

function nombreUnico(usados: Set<string>, generar: () => string): string {
  let nombre = generar();
  while (usados.has(nombre)) nombre = generar();
  usados.add(nombre);
  return nombre;
}

/**
 * Datos de demostración: 60 clientes (20 mayoristas), 150 comprobantes
 * y pedidos abiertos en caja. Determinista según la semilla del generador.
 */
export function generarDatosSemilla(a: Aleatorio, ahora: Date, totalVendedores = 3): DatosSemilla {
  const nombresUsados = new Set<string>();
  const docsUsados = new Set<string>();
  const docUnico = (generar: () => string) => nombreUnico(docsUsados, generar);
  const personaUnica = () => {
    let persona = generarPersona(a);
    while (nombresUsados.has(nombreCompleto(persona))) persona = generarPersona(a);
    nombresUsados.add(nombreCompleto(persona));
    return persona;
  };
  const clientes: ClienteSemilla[] = [];

  // 20 mayoristas de provincias (RUC 20).
  for (let i = 0; i < 20; i++) {
    const nombre = nombreUnico(nombresUsados, () => generarRazonSocial(a));
    const alias = i < 8 ? [variarRazonSocial(a, nombre)].filter((v) => v !== nombre) : [];
    clientes.push({
      tipoDoc: 'RUC',
      numeroDoc: docUnico(() => generarRuc(a, '20')),
      nombre,
      tipo: 'MAYORISTA',
      telefono: generarCelular(a),
      correo: correoDe(nombre),
      consentimiento: a.probabilidad(0.8),
      vendedor: i % totalVendedores,
      alias,
      cuentasOrigen: i < 10 ? [{ banco: 'BCP', cuenta: generarCuentaBcp(a) }] : [],
    });
  }

  // 25 minoristas: 15 personas naturales con negocio (RUC 10) y 10 con DNI.
  for (let i = 0; i < 25; i++) {
    const persona = personaUnica();
    const nombre = nombreCompleto(persona);
    const dni = generarDni(a);
    const conRuc = i < 15;
    clientes.push({
      tipoDoc: conRuc ? 'RUC' : 'DNI',
      numeroDoc: docUnico(() => (conRuc ? generarRuc(a, '10', dni) : dni)),
      nombre,
      tipo: 'MINORISTA',
      telefono: generarCelular(a),
      correo: a.probabilidad(0.5) ? correoDe(nombre) : null,
      consentimiento: a.probabilidad(0.5),
      vendedor: a.probabilidad(0.6) ? a.entero(0, totalVendedores - 1) : null,
      // Algunos minoristas pagan desde la cuenta de un familiar.
      alias: i < 4 ? [nombreCompleto(generarFamiliar(a, persona))] : [],
      cuentasOrigen: [],
    });
  }

  // 15 consumidores finales (DNI).
  for (let i = 0; i < 15; i++) {
    const persona = personaUnica();
    const nombre = nombreCompleto(persona);
    clientes.push({
      tipoDoc: 'DNI',
      numeroDoc: docUnico(() => generarDni(a)),
      nombre,
      tipo: 'CONSUMIDOR_FINAL',
      telefono: generarCelular(a),
      correo: null,
      consentimiento: a.probabilidad(0.2),
      vendedor: null,
      alias: i < 2 ? [variarNombrePersona(a, persona)] : [],
      cuentasOrigen: [],
    });
  }

  const comprobantes = generarComprobantes(a, ahora, clientes);
  const pedidos = generarPedidos(a, ahora, clientes);
  return { clientes, comprobantes, pedidos };
}

function generarComprobantes(
  a: Aleatorio,
  ahora: Date,
  clientes: ClienteSemilla[],
): ComprobanteSemilla[] {
  const hoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const borradores: Omit<ComprobanteSemilla, 'numero'>[] = [];

  const agregar = (cliente: ClienteSemilla, esMayorista: boolean) => {
    const dias = a.entero(0, 120);
    const emision = new Date(hoy - dias * DIA_MS);
    const plazo = esMayorista ? 30 : 15;
    const enDolares = esMayorista && a.probabilidad(0.1);
    const total = enDolares
      ? a.monto(500, 8000)
      : esMayorista
        ? a.monto(1500, 25000)
        : a.monto(150, 3000);
    const estado = estadoSegunAntiguedad(a, dias);
    const saldo =
      estado === 'PAGADO' ? 0 : estado === 'PARCIAL' ? redondear(total * a.monto(0.3, 0.8)) : total;
    const esFactura = cliente.tipoDoc === 'RUC';
    borradores.push({
      tipo: esFactura ? 'FACTURA' : 'BOLETA',
      serie: esFactura ? (esMayorista ? 'F001' : 'F002') : 'B001',
      numeroDocCliente: cliente.numeroDoc,
      fechaEmision: emision,
      fechaVencimiento: new Date(emision.getTime() + plazo * DIA_MS),
      total,
      saldoPendiente: saldo,
      moneda: enDolares ? 'USD' : 'PEN',
      estado,
    });
  };

  const mayoristas = clientes.filter((c) => c.tipo === 'MAYORISTA');
  const minoristas = clientes.filter((c) => c.tipo === 'MINORISTA');
  for (const m of mayoristas) for (let i = 0; i < 5; i++) agregar(m, true);
  for (let i = 0; i < 50; i++) agregar(minoristas[i % minoristas.length]!, false);

  // Numeración correlativa por serie, en orden de emisión.
  borradores.sort((x, y) => x.fechaEmision.getTime() - y.fechaEmision.getTime());
  const correlativos = new Map<string, number>([
    ['F001', 2100],
    ['F002', 850],
    ['B001', 5400],
  ]);
  return borradores.map((b) => {
    const numero = (correlativos.get(b.serie) ?? 0) + 1;
    correlativos.set(b.serie, numero);
    return { ...b, numero };
  });
}

function generarPedidos(a: Aleatorio, ahora: Date, clientes: ClienteSemilla[]): PedidoSemilla[] {
  const minoristas = clientes.filter((c) => c.tipo === 'MINORISTA');
  const puestos = [
    ['Tienda Central', 'Caja 1'],
    ['Tienda Central', 'Caja 2'],
    ['Tienda Mercado Mayorista', 'Caja 1'],
  ] as const;
  return Array.from({ length: 5 }, (_, i) => {
    const [tienda, caja] = puestos[i % puestos.length]!;
    return {
      tienda,
      caja,
      monto: a.elegir([a.entero(2, 60) * 5, a.monto(45, 1200)]),
      numeroDocCliente: i < 2 ? a.elegir(minoristas).numeroDoc : null,
      creadoEn: new Date(ahora.getTime() - a.entero(1, 25) * 60_000),
    };
  });
}
