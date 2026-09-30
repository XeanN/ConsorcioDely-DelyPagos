import { ChangeDetectionStrategy, Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatearMonto } from '../../compartido/formato';
import { canal, horaLima, hoyLima } from '../monitor/presentacion';
import {
  ConciliacionApi,
  mensajeError,
  type DestinoBuscado,
  type EstadoConciliacion,
  type ItemBandeja,
  type TipoDestino,
} from './conciliacion-api';

const PESTANAS: { estado: EstadoConciliacion; etiqueta: string; clase: string }[] = [
  { estado: 'PROBABLE', etiqueta: 'Por confirmar', clase: 'bg-amber-100 text-amber-900' },
  { estado: 'SIN_IDENTIFICAR', etiqueta: 'Sin identificar', clase: 'bg-red-100 text-red-800' },
  { estado: 'CONCILIADO', etiqueta: 'Conciliados', clase: 'bg-emerald-100 text-emerald-800' },
  { estado: 'DESCARTADO', etiqueta: 'Descartados', clase: 'bg-slate-200 text-slate-600' },
];

/** Bandeja de trabajo: confirmar probables, asignar los no identificados, descartar. */
@Component({
  selector: 'app-bandeja-conciliacion',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bandeja.html',
})
export class BandejaConciliacion implements OnInit {
  private readonly api = inject(ConciliacionApi);

  readonly puedeProcesar = input(false);

  protected readonly pestanas = PESTANAS;
  protected readonly canal = canal;
  protected readonly hora = horaLima;
  protected readonly monto = formatearMonto;
  protected readonly porcentaje = (p: number) => `${Math.round(p * 100)}%`;

  protected readonly estado = signal<EstadoConciliacion>('PROBABLE');
  protected readonly items = signal<ItemBandeja[]>([]);
  protected readonly cargando = signal(true);
  protected readonly ocupado = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly abierto = signal<{ id: string; modo: 'buscar' | 'descartar' | 'revertir' } | null>(null);
  /** Día que se revisa. Vacío = todos los días (solo para las bandejas de pendientes). */
  protected fecha = hoyLima();
  protected readonly hoy = hoyLima();
  protected motivoReversion = '';
  protected readonly resultados = signal<DestinoBuscado[]>([]);
  protected textoBusqueda = '';
  protected motivoDescarte = '';
  protected readonly esHistorial = computed(() => this.estado() === 'CONCILIADO' || this.estado() === 'DESCARTADO');

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  protected async cambiarPestana(estado: EstadoConciliacion): Promise<void> {
    this.estado.set(estado);
    this.abierto.set(null);
    this.cargando.set(true);
    await this.recargar();
  }

  async recargar(): Promise<void> {
    try {
      const estado = this.estado();
      const historial = estado === 'CONCILIADO' || estado === 'DESCARTADO';
      this.items.set(await this.api.bandeja(estado, this.fecha || (historial ? hoyLima() : undefined)));
    } catch (error) {
      this.error.set(mensajeError(error));
    } finally {
      this.cargando.set(false);
    }
  }

  protected destinoElegido(item: ItemBandeja): string {
    const d = item.destino;
    if (!d) return '—';
    return item.candidatos.find((c) => c.id === d.id)?.descripcion ?? (d.tipo === 'PEDIDO' ? 'Pedido en caja' : 'Comprobante');
  }

  protected async confirmar(item: ItemBandeja, tipo: TipoDestino, id: string, descripcion: string): Promise<void> {
    await this.ejecutar(
      () => this.api.confirmar(item.id, tipo, id),
      `Pago de ${this.monto(item.movimiento.monto, item.movimiento.moneda)} aplicado a ${descripcion}.`,
    );
  }

  protected async cambiarFecha(fecha: string): Promise<void> {
    this.fecha = fecha;
    this.cargando.set(true);
    await this.recargar();
  }

  protected async revertir(item: ItemBandeja): Promise<void> {
    if (this.motivoReversion.trim().length < 5) return;
    await this.ejecutar(
      () => this.api.revertir(item.id, this.motivoReversion.trim()),
      'Deshecho: el pago volvió a "Sin identificar" para asignarlo correctamente.',
    );
  }

  protected abrir(id: string, modo: 'buscar' | 'descartar' | 'revertir'): void {
    this.motivoReversion = '';
    this.abierto.set({ id, modo });
    this.resultados.set([]);
    this.textoBusqueda = '';
    this.motivoDescarte = '';
  }

  protected async buscar(item: ItemBandeja): Promise<void> {
    this.resultados.set(await this.api.buscarDestinos(this.textoBusqueda.trim(), item.movimiento.moneda).catch(() => []));
  }

  protected async descartar(item: ItemBandeja): Promise<void> {
    if (this.motivoDescarte.trim().length < 3) return;
    await this.ejecutar(() => this.api.descartar(item.id, this.motivoDescarte.trim()), 'Pago descartado.');
  }

  protected async procesar(): Promise<void> {
    await this.ejecutar(async () => {
      const dia = this.fecha || hoyLima();
      const { procesados } = await this.api.procesar(dia);
      this.aviso.set(`${procesados} pagos pendientes del ${dia} procesados.`);
    });
  }

  private async ejecutar(operacion: () => Promise<unknown>, exito?: string): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      await operacion();
      if (exito) this.aviso.set(exito);
      this.abierto.set(null);
    } catch (error) {
      this.error.set(mensajeError(error));
    } finally {
      this.ocupado.set(false);
      await this.recargar();
    }
  }
}
