import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
  type OnInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { EnVivo } from '../../core/en-vivo/en-vivo';
import { ConciliacionApi, type Candidato, type Explicacion } from '../conciliacion/conciliacion-api';
import { formatearMonto } from '../../compartido/formato';
import {
  MonitorApi,
  type CuentaDely,
  type Filtros,
  type Movimiento,
  type Resumen,
} from './monitor-api';
import {
  CANALES,
  ESTADOS,
  canal,
  cumpleFiltros,
  estado,
  horaLima,
  hoyLima,
  leerMonto,
  sumarAlResumen,
} from './presentacion';

const FILTROS_INICIALES = (): Filtros => ({
  fecha: hoyLima(),
  cuentaId: '',
  canal: '',
  estado: '',
  q: '',
  monto: null,
});

@Component({
  selector: 'app-monitor',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './monitor.html',
})
export class Monitor implements OnInit {
  private readonly api = inject(MonitorApi);
  private readonly enVivo = inject(EnVivo);
  private readonly conciliacion = inject(ConciliacionApi);
  protected readonly detalle = signal<{ id: string; explicacion: Explicacion | null; mensaje: string } | null>(null);

  protected readonly canales = CANALES;
  protected readonly estados = ESTADOS;
  protected readonly canal = canal;
  protected readonly estado = estado;
  protected readonly hora = horaLima;
  protected readonly monto = formatearMonto;
  protected readonly conexion = this.enVivo.estado;
  protected readonly hoy = hoyLima();

  protected readonly filtros = signal<Filtros>(FILTROS_INICIALES());
  protected readonly movimientos = signal<Movimiento[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly resumen = signal<Resumen | null>(null);
  protected readonly cuentas = signal<CuentaDely[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly nuevos = signal<ReadonlySet<string>>(new Set());
  protected readonly esHoy = computed(() => this.filtros().fecha === hoyLima());

  // Búsqueda rápida del cajero: "¿llegó el de 350?"
  protected readonly textoBusqueda = signal('');
  protected readonly montoBuscado = computed(() => leerMonto(this.textoBusqueda()));
  protected readonly coincidencias = signal<Movimiento[]>([]);
  protected readonly buscando = signal(false);

  protected readonly resumenPorCanal = computed(() => {
    const r = this.resumen();
    return CANALES.map((c) => {
      const pen = r?.porCanal.find((g) => g.canal === c.valor && g.moneda === 'PEN');
      const usd = r?.porCanal.find((g) => g.canal === c.valor && g.moneda === 'USD');
      return { ...c, pen, usd, cantidad: (pen?.cantidad ?? 0) + (usd?.cantidad ?? 0) };
    });
  });

  private temporizadorBusqueda: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const cerrar = this.enVivo.conectar('/api/v1/movimientos/en-vivo', (evento, datos) => {
      if (evento === 'movimiento') this.alLlegar(datos as Movimiento);
      if (evento === 'movimiento-actualizado') this.alActualizarse(datos as Movimiento);
    });
    inject(DestroyRef).onDestroy(() => {
      cerrar();
      clearTimeout(this.temporizadorBusqueda);
    });
  }

  async ngOnInit(): Promise<void> {
    this.api
      .cuentas()
      .then((c) => this.cuentas.set(c))
      .catch(() => undefined);
    await this.cargar();
  }

  protected cuentaDe(id: string): string {
    const c = this.cuentas().find((x) => x.id === id);
    return c ? `${c.banco} ${c.moneda}` : id;
  }

  protected cambiarFiltro<K extends keyof Filtros>(campo: K, valor: Filtros[K]): void {
    this.filtros.update((f) => ({ ...f, [campo]: valor }));
    void this.cargar();
  }

  protected limpiarFiltros(): void {
    this.filtros.set(FILTROS_INICIALES());
    void this.cargar();
  }

  protected buscarMonto(texto: string): void {
    this.textoBusqueda.set(texto);
    clearTimeout(this.temporizadorBusqueda);
    const valor = leerMonto(texto);
    if (valor === null) {
      this.coincidencias.set([]);
      return;
    }
    this.buscando.set(true);
    this.temporizadorBusqueda = setTimeout(async () => {
      try {
        const { items } = await this.api.listar({ ...FILTROS_INICIALES(), monto: valor }, undefined, 20);
        if (this.montoBuscado() === valor) this.coincidencias.set(items);
      } finally {
        this.buscando.set(false);
      }
    }, 250);
  }

  protected async cargarMas(): Promise<void> {
    const cursor = this.cursor();
    if (!cursor) return;
    const { items, siguienteCursor } = await this.api.listar(this.filtros(), cursor);
    this.movimientos.update((actuales) => [...actuales, ...items]);
    this.cursor.set(siguienteCursor);
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const filtros = this.filtros();
      const [lista, resumen] = await Promise.all([
        this.api.listar(filtros),
        this.api.resumen(filtros.fecha),
      ]);
      this.movimientos.set(lista.items);
      this.cursor.set(lista.siguienteCursor);
      this.resumen.set(resumen);
    } catch {
      this.error.set('No se pudieron cargar los movimientos. Reintente en unos segundos.');
    } finally {
      this.cargando.set(false);
    }
  }

  protected async explicar(m: Movimiento): Promise<void> {
    if (this.detalle()?.id === m.id) {
      this.detalle.set(null);
      return;
    }
    this.detalle.set({ id: m.id, explicacion: null, mensaje: 'Cargando…' });
    try {
      const explicacion = await this.conciliacion.explicar(m.id);
      this.detalle.set({ id: m.id, explicacion, mensaje: '' });
    } catch {
      this.detalle.set({ id: m.id, explicacion: null, mensaje: 'Este pago todavía no se ha conciliado.' });
    }
  }

  protected candidatosTexto(candidatos: Candidato[]): string {
    return candidatos.map((c) => `${c.descripcion} (${Math.round(c.puntaje * 100)}%)`).join(' · ');
  }

  /** Un pago cambió de estado (p. ej. se concilió): se actualiza donde se esté mostrando. */
  private alActualizarse(m: Movimiento): void {
    const reemplazar = (lista: Movimiento[]) => lista.map((x) => (x.id === m.id ? m : x));
    this.movimientos.update(reemplazar);
    this.coincidencias.update(reemplazar);
    if (this.detalle()?.id === m.id) {
      this.detalle.set(null);
      void this.explicar(m);
    }
  }

  private alLlegar(m: Movimiento): void {
    const filtros = this.filtros();
    if (this.movimientos().some((x) => x.id === m.id)) return;

    if (hoyLima(new Date(m.fechaHora)) === filtros.fecha) {
      this.resumen.update((r) => (r ? sumarAlResumen(r, m) : r));
    }
    if (cumpleFiltros(m, filtros)) {
      this.movimientos.update((actuales) => [m, ...actuales]);
      this.marcarNuevo(m.id);
    }
    const buscado = this.montoBuscado();
    if (buscado !== null && Math.abs(m.monto - buscado) < 0.005 && hoyLima(new Date(m.fechaHora)) === hoyLima()) {
      this.coincidencias.update((c) => [m, ...c]);
      this.marcarNuevo(m.id);
    }
  }

  private marcarNuevo(id: string): void {
    this.nuevos.update((s) => new Set(s).add(id));
    setTimeout(() => {
      this.nuevos.update((s) => {
        const copia = new Set(s);
        copia.delete(id);
        return copia;
      });
    }, 8_000);
  }
}
