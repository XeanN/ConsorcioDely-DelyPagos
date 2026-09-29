import { formatearSoles } from './formato.js';
import { claveComprobante, documentoDelCliente, extraerIdentificadores } from './identificadores.js';
import { normalizarNombre } from './normalizar.js';
import { similitudNombres } from './similitud.js';

// ─── Entradas ──────────────────────────────────────────────

export interface ClienteCandidato {
  id: string;
  nombre: string;
  tipoDoc: 'DNI' | 'RUC' | 'CE';
  numeroDoc: string;
  alias: string[];
  /** Cuentas desde las que ya pagó antes (normalizadas a solo dígitos). */
  cuentasOrigen: string[];
}

export interface PedidoCandidato {
  tipo: 'PEDIDO';
  id: string;
  monto: number;
  moneda: 'PEN' | 'USD';
  creadoEn: Date;
  tienda: string;
  caja: string;
  cliente: ClienteCandidato | null;
}

export interface ComprobanteCandidato {
  tipo: 'COMPROBANTE';
  id: string;
  serie: string;
  numero: number;
  saldoPendiente: number;
  moneda: 'PEN' | 'USD';
  fechaEmision: Date;
  cliente: ClienteCandidato;
}

export type Candidato = PedidoCandidato | ComprobanteCandidato;

export interface MovimientoAConciliar {
  monto: number;
  moneda: 'PEN' | 'USD';
  fechaHora: Date;
  ordenanteNombre: string | null;
  ordenanteNumeroDoc: string | null;
  ordenanteCuenta: string | null;
  referencia: string | null;
}

export interface ConfigMotor {
  pesos: { monto: number; nombre: number; referencia: number; cuenta: number };
  umbralConciliado: number;
  umbralProbable: number;
  ventanaPedidoMin: number;
  /** Diferencia máxima por redondeo (en la moneda del pago). */
  toleranciaMonto: number;
  /** Dos candidatos con puntajes a menos de esta distancia se consideran empatados. */
  margenEmpate: number;
}

export const CONFIG_MOTOR_POR_DEFECTO: ConfigMotor = {
  pesos: { monto: 0.35, nombre: 0.25, referencia: 0.2, cuenta: 0.2 },
  umbralConciliado: 0.85,
  umbralProbable: 0.6,
  ventanaPedidoMin: 30,
  toleranciaMonto: 1,
  margenEmpate: 0.1,
};

// ─── Salidas ───────────────────────────────────────────────

export type EstadoResultado = 'CONCILIADO' | 'PROBABLE' | 'SIN_IDENTIFICAR';

export interface Evaluacion {
  tipo: Candidato['tipo'];
  id: string;
  clienteId: string | null;
  descripcion: string;
  puntaje: number;
  montoAplicado: number;
  esParcial: boolean;
  motivos: string[];
}

export interface ResultadoConciliacion {
  estado: EstadoResultado;
  puntaje: number;
  destino: Evaluacion | null;
  motivos: string[];
  /** Mejores candidatos (para que una persona elija si hace falta). */
  candidatos: Evaluacion[];
}

// ─── Motor ─────────────────────────────────────────────────

const soloDigitos = (s: string) => s.replace(/\D/g, '');
const redondear = (n: number) => Math.round(n * 1000) / 1000;
const MINUTO = 60_000;

interface Senal {
  peso: number;
  valor: number;
}

function describir(c: Candidato): string {
  if (c.tipo === 'PEDIDO') {
    return `Pedido de ${c.caja} (${c.tienda})${c.cliente ? ` · ${c.cliente.nombre}` : ''}`;
  }
  return `${c.serie}-${String(c.numero).padStart(8, '0')} · ${c.cliente.nombre}`;
}

function evaluar(
  m: MovimientoAConciliar,
  c: Candidato,
  ids: ReturnType<typeof extraerIdentificadores>,
  cfg: ConfigMotor,
): Evaluacion | null {
  if (c.moneda !== m.moneda) return null;
  const motivos: string[] = [];
  const senales: Senal[] = [];
  const objetivo = c.tipo === 'PEDIDO' ? c.monto : c.saldoPendiente;
  const diferencia = Math.abs(m.monto - objetivo);
  let esParcial = false;

  // 1. Monto
  let valorMonto: number;
  if (diferencia < 0.005) {
    valorMonto = 1;
    motivos.push('monto exacto');
  } else if (diferencia <= cfg.toleranciaMonto) {
    valorMonto = 1 - (diferencia / cfg.toleranciaMonto) * 0.5;
    motivos.push(`monto cercano (diferencia ${formatearSoles(diferencia, m.moneda)})`);
  } else if (c.tipo === 'COMPROBANTE' && m.monto < objetivo) {
    valorMonto = 0.6;
    esParcial = true;
    motivos.push(`pago parcial (${formatearSoles(m.monto, m.moneda)} de ${formatearSoles(objetivo, m.moneda)})`);
  } else {
    return null; // El monto no corresponde a este candidato.
  }
  const senalMonto: Senal = { peso: cfg.pesos.monto, valor: valorMonto };
  senales.push(senalMonto);

  const cliente = c.cliente;

  // 2. Nombre del ordenante frente al cliente y sus alias aprendidos
  let posibleFamiliar = false;
  if (m.ordenanteNombre && cliente) {
    let mejor = { valor: 0, posibleFamiliar: false, nombre: cliente.nombre, esAlias: false };
    const ordenanteNormalizado = normalizarNombre(m.ordenanteNombre);
    for (const alias of cliente.alias) {
      if (normalizarNombre(alias) === ordenanteNormalizado) {
        mejor = { valor: 1, posibleFamiliar: false, nombre: alias, esAlias: true };
      }
    }
    if (mejor.valor < 1) {
      for (const [nombre, esAlias] of [[cliente.nombre, false], ...cliente.alias.map((a) => [a, true])] as [
        string,
        boolean,
      ][]) {
        const s = similitudNombres(m.ordenanteNombre, nombre);
        if (s.valor > mejor.valor) mejor = { ...s, nombre, esAlias };
      }
    }
    posibleFamiliar = mejor.posibleFamiliar;
    senales.push({ peso: cfg.pesos.nombre, valor: mejor.valor });
    if (mejor.valor >= 0.85) {
      motivos.push(mejor.esAlias ? `nombre conocido (alias "${mejor.nombre}")` : 'nombre del cliente');
    } else if (posibleFamiliar) {
      motivos.push('mismo apellido, otro nombre (¿familiar?)');
    } else if (mejor.valor >= 0.5) {
      motivos.push(`nombre parecido (${Math.round(mejor.valor * 100)}%)`);
    } else {
      motivos.push('nombre distinto');
    }
  }

  // 3. Referencia o documento
  let porReferencia = false;
  let porDocumento = false;
  const hayIdentificadores = ids.comprobantes.size > 0 || ids.documentos.size > 0;
  if (hayIdentificadores && (c.tipo === 'COMPROBANTE' || cliente)) {
    if (c.tipo === 'COMPROBANTE' && ids.comprobantes.has(claveComprobante(c.serie, c.numero))) {
      porReferencia = true;
      motivos.push(`referencia ${c.serie}-${c.numero}`);
    }
    if (cliente && documentoDelCliente(ids.documentos, cliente.numeroDoc)) {
      porDocumento = true;
      motivos.push(`documento del cliente (${cliente.tipoDoc})`);
    }
    senales.push({ peso: cfg.pesos.referencia, valor: porReferencia || porDocumento ? 1 : 0 });
  }

  // 4. Cuenta de origen ya vista para este cliente
  let porCuenta = false;
  if (m.ordenanteCuenta && cliente && cliente.cuentasOrigen.length > 0) {
    porCuenta = cliente.cuentasOrigen.includes(soloDigitos(m.ordenanteCuenta));
    senales.push({ peso: cfg.pesos.cuenta, valor: porCuenta ? 1 : 0 });
    if (porCuenta) motivos.push('cuenta de origen conocida');
  }

  // Pedido: solo si se creó dentro de la ventana de espera.
  if (c.tipo === 'PEDIDO') {
    const minutos = Math.round((m.fechaHora.getTime() - c.creadoEn.getTime()) / MINUTO);
    motivos.push(minutos <= 0 ? 'pedido recién creado' : `pedido de hace ${minutos} min`);
  }

  const identidadFuerte = porReferencia || porDocumento || porCuenta;
  // En un pago parcial, que el monto no coincida con la factura es lo esperado:
  // si el cliente está bien identificado, el monto no resta.
  if (esParcial && identidadFuerte) senalMonto.valor = 0.85;

  // Las señales sin dato no penalizan: los pesos se reparten entre las disponibles.
  const pesoTotal = senales.reduce((s, x) => s + x.peso, 0);
  let puntaje = senales.reduce((s, x) => s + x.peso * x.valor, 0) / pesoTotal;

  // La referencia exacta de la factura concilia aunque el nombre no coincida.
  if (porReferencia) puntaje = Math.max(puntaje, 0.9);
  // Un comprobante no se concilia solo por monto: hace falta algo que identifique al cliente.
  if (c.tipo === 'COMPROBANTE' && senales.length === 1) puntaje = Math.min(puntaje, 0.8);
  // Un pago parcial solo se aplica automáticamente si el cliente está bien identificado.
  if (esParcial && !identidadFuerte) puntaje = Math.min(puntaje, 0.8);
  // Un posible familiar siempre requiere confirmación humana.
  if (posibleFamiliar && !identidadFuerte) puntaje = Math.min(puntaje, 0.8);

  return {
    tipo: c.tipo,
    id: c.id,
    clienteId: cliente?.id ?? null,
    descripcion: describir(c),
    puntaje: redondear(puntaje),
    montoAplicado: esParcial ? m.monto : Math.min(m.monto, objetivo),
    esParcial,
    motivos,
  };
}

/** Para pagos parciales se aplica al comprobante más antiguo de cada cliente. */
function soloMasAntiguoPorCliente(evaluaciones: Evaluacion[], candidatos: Candidato[]): Evaluacion[] {
  const fechas = new Map(
    candidatos.filter((c) => c.tipo === 'COMPROBANTE').map((c) => [c.id, (c as ComprobanteCandidato).fechaEmision]),
  );
  const elegidos = new Map<string, Evaluacion>();
  const resto: Evaluacion[] = [];
  for (const e of evaluaciones) {
    if (!e.esParcial || !e.clienteId) {
      resto.push(e);
      continue;
    }
    const actual = elegidos.get(e.clienteId);
    if (!actual || fechas.get(e.id)! < fechas.get(actual.id)!) elegidos.set(e.clienteId, e);
  }
  return [...resto, ...elegidos.values()];
}

/**
 * Decide a qué pedido o comprobante corresponde un abono.
 * Función pura: no toca la base de datos, así se puede probar a fondo.
 */
export function conciliar(
  m: MovimientoAConciliar,
  candidatos: Candidato[],
  cfg: ConfigMotor = CONFIG_MOTOR_POR_DEFECTO,
): ResultadoConciliacion {
  const ids = extraerIdentificadores(m.referencia, m.ordenanteNumeroDoc);
  const enVentana = candidatos.filter((c) => {
    if (c.tipo !== 'PEDIDO') return true;
    const minutos = (m.fechaHora.getTime() - c.creadoEn.getTime()) / MINUTO;
    return minutos >= -2 && minutos <= cfg.ventanaPedidoMin;
  });

  const evaluaciones = soloMasAntiguoPorCliente(
    enVentana.map((c) => evaluar(m, c, ids, cfg)).filter((e): e is Evaluacion => e !== null),
    enVentana,
  ).sort(
    (a, b) =>
      b.puntaje - a.puntaje ||
      // A igual puntaje: primero pedidos en caja, luego pagos completos.
      Number(b.tipo === 'PEDIDO') - Number(a.tipo === 'PEDIDO') ||
      Number(a.esParcial) - Number(b.esParcial),
  );

  const mejores = evaluaciones.slice(0, 5);
  const [primero, segundo] = evaluaciones;
  if (!primero || primero.puntaje < cfg.umbralProbable) {
    return {
      estado: 'SIN_IDENTIFICAR',
      puntaje: primero?.puntaje ?? 0,
      destino: null,
      motivos: primero ? ['ningún candidato alcanza el mínimo'] : ['sin pedidos ni comprobantes compatibles'],
      candidatos: mejores,
    };
  }

  // Regla de seguridad: dos destinos distintos con el mismo monto y puntaje parecido
  // nunca se concilian automáticamente.
  const empate =
    segundo !== undefined &&
    primero.puntaje - segundo.puntaje < cfg.margenEmpate &&
    Math.abs(primero.montoAplicado - segundo.montoAplicado) < 0.005 &&
    (primero.clienteId === null || primero.clienteId !== segundo.clienteId);

  if (empate) {
    return {
      estado: 'PROBABLE',
      puntaje: Math.min(primero.puntaje, cfg.umbralConciliado - 0.001),
      destino: primero,
      motivos: [...primero.motivos, `${evaluaciones.filter((e) => primero.puntaje - e.puntaje < cfg.margenEmpate).length} candidatos con el mismo monto: requiere confirmación`],
      candidatos: mejores,
    };
  }

  return {
    estado: primero.puntaje >= cfg.umbralConciliado ? 'CONCILIADO' : 'PROBABLE',
    puntaje: primero.puntaje,
    destino: primero,
    motivos: primero.motivos,
    candidatos: mejores,
  };
}
