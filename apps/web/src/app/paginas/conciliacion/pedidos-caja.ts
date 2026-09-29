import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { formatearMonto } from '../../compartido/formato';
import { leerMonto } from '../monitor/presentacion';
import { ConciliacionApi, mensajeError, type ClienteBuscado, type Pedido } from './conciliacion-api';

/** El cajero registra el pedido que espera pago; cuando el abono llega, se marca pagado solo. */
@Component({
  selector: 'app-pedidos-caja',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="titulo-pedidos">
      <h3 id="titulo-pedidos" class="text-lg font-bold text-slate-900">Pedidos esperando pago</h3>
      <p class="text-sm text-slate-600">
        Registre el monto que el cliente va a pagar por Yape, Plin o transferencia. Cuando el abono llegue, se marcará
        como pagado automáticamente.
      </p>

      <form class="mt-4 flex flex-wrap items-end gap-3" (ngSubmit)="crear()">
        <div>
          <label for="pedido-monto" class="mb-1 block text-xs font-semibold text-slate-700">Monto</label>
          <div class="flex items-center rounded-lg border-2 border-slate-400 bg-white focus-within:border-slate-900">
            <span class="pl-3 text-lg font-semibold text-slate-500" aria-hidden="true">S/</span>
            <input id="pedido-monto" name="monto" inputmode="decimal" autocomplete="off" placeholder="0.00"
              class="w-32 bg-transparent px-2 py-2 text-xl font-bold text-black focus:outline-none"
              [(ngModel)]="textoMonto" />
          </div>
        </div>
        <div>
          <label for="pedido-caja" class="mb-1 block text-xs font-semibold text-slate-700">Caja</label>
          <select id="pedido-caja" name="caja" class="rounded-md border border-slate-300 bg-white px-2 py-2.5 text-sm text-black" [(ngModel)]="caja">
            @for (c of cajas; track c) {
              <option [value]="c">{{ c }}</option>
            }
          </select>
        </div>
        <div class="relative min-w-56 flex-1">
          <label for="pedido-cliente" class="mb-1 block text-xs font-semibold text-slate-700">Cliente (opcional)</label>
          @if (cliente(); as c) {
            <div class="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-2 py-2 text-sm">
              <span class="text-slate-900">{{ c.nombre }} <span class="text-slate-500">· {{ c.tipoDoc }} {{ c.numeroDoc }}</span></span>
              <button type="button" class="ml-2 text-slate-600 hover:text-black" (click)="cliente.set(null)" aria-label="Quitar cliente">✕</button>
            </div>
          } @else {
            <input id="pedido-cliente" name="cliente" type="search" autocomplete="off" placeholder="Nombre, DNI o RUC"
              class="w-full rounded-md border border-slate-300 px-2 py-2 text-sm text-black"
              [ngModel]="textoCliente()" (ngModelChange)="buscarCliente($event)" />
            @if (resultadosCliente().length > 0) {
              <ul class="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg" role="listbox">
                @for (r of resultadosCliente(); track r.id) {
                  <li>
                    <button type="button" class="w-full px-3 py-2 text-left text-sm hover:bg-slate-100" (click)="elegirCliente(r)">
                      {{ r.nombre }} <span class="text-slate-500">· {{ r.tipoDoc }} {{ r.numeroDoc }}</span>
                    </button>
                  </li>
                }
              </ul>
            }
          }
        </div>
        <button type="submit" class="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          [disabled]="enviando() || leerMonto(textoMonto) === null">
          Registrar pedido
        </button>
      </form>
      @if (error(); as e) {
        <p role="alert" class="mt-2 text-sm text-red-700">{{ e }}</p>
      }

      <div class="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (p of abiertos(); track p.id) {
          <article class="rounded-lg border-2 border-amber-300 bg-amber-50 p-3">
            <div class="flex items-start justify-between gap-2">
              <p class="text-2xl font-bold text-slate-900">{{ monto(p.monto, p.moneda) }}</p>
              <span class="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900">Esperando</span>
            </div>
            <p class="text-sm text-slate-700">{{ p.caja }} · hace {{ minutos(p.creadoEn) }} min</p>
            @if (p.cliente) {
              <p class="text-sm text-slate-600">{{ p.cliente }}</p>
            }
            @if (cancelando() === p.id) {
              <div class="mt-2 flex gap-2">
                <button type="button" class="rounded-md bg-red-700 px-2 py-1 text-xs font-semibold text-white" (click)="cancelar(p)">Sí, cancelar</button>
                <button type="button" class="rounded-md border border-slate-300 px-2 py-1 text-xs" (click)="cancelando.set(null)">No</button>
              </div>
            } @else {
              <button type="button" class="mt-2 text-xs text-slate-600 underline hover:text-black" (click)="cancelando.set(p.id)">Cancelar pedido</button>
            }
          </article>
        }
        @for (p of pagados(); track p.id) {
          <article class="rounded-lg border-2 border-emerald-300 bg-emerald-50 p-3" [class.ring-4]="recienPagados().has(p.id)" [class.ring-emerald-400]="recienPagados().has(p.id)">
            <div class="flex items-start justify-between gap-2">
              <p class="text-2xl font-bold text-slate-900">{{ monto(p.monto, p.moneda) }}</p>
              <span class="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-bold text-white">✓ Pagado</span>
            </div>
            <p class="text-sm text-slate-700">{{ p.caja }}{{ p.cliente ? ' · ' + p.cliente : '' }}</p>
          </article>
        }
      </div>
      @if (abiertos().length === 0 && pagados().length === 0) {
        <p class="mt-4 text-sm text-slate-500">No hay pedidos esperando pago.</p>
      }
    </section>
  `,
})
export class PedidosCaja implements OnInit {
  private readonly api = inject(ConciliacionApi);

  protected readonly cajas = ['Caja 1', 'Caja 2', 'Caja 3'];
  protected readonly monto = formatearMonto;
  protected readonly leerMonto = leerMonto;
  protected textoMonto = '';
  protected caja = 'Caja 1';

  protected readonly abiertos = signal<Pedido[]>([]);
  protected readonly pagados = signal<Pedido[]>([]);
  protected readonly recienPagados = signal<ReadonlySet<string>>(new Set());
  protected readonly cliente = signal<ClienteBuscado | null>(null);
  protected readonly textoCliente = signal('');
  protected readonly resultadosCliente = signal<ClienteBuscado[]>([]);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly cancelando = signal<string | null>(null);
  private readonly ahora = signal(Date.now());
  private busqueda: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const reloj = setInterval(() => this.ahora.set(Date.now()), 30_000);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(reloj);
      clearTimeout(this.busqueda);
    });
  }

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  protected minutos(iso: string): number {
    return Math.max(0, Math.floor((this.ahora() - new Date(iso).getTime()) / 60_000));
  }

  /** Se llama cuando llega un evento en vivo: detecta los pedidos recién pagados. */
  async recargar(): Promise<void> {
    const antes = new Set(this.abiertos().map((p) => p.id));
    const [abiertos, pagados] = await Promise.all([this.api.pedidos('ABIERTO'), this.api.pedidos('PAGADO')]);
    this.abiertos.set(abiertos);
    this.pagados.set(pagados.slice(0, 6));
    const nuevos = pagados.filter((p) => antes.has(p.id)).map((p) => p.id);
    if (nuevos.length > 0) {
      this.recienPagados.set(new Set(nuevos));
      setTimeout(() => this.recienPagados.set(new Set()), 10_000);
    }
  }

  protected buscarCliente(texto: string): void {
    this.textoCliente.set(texto);
    clearTimeout(this.busqueda);
    if (texto.trim().length < 2) {
      this.resultadosCliente.set([]);
      return;
    }
    this.busqueda = setTimeout(async () => {
      this.resultadosCliente.set(await this.api.buscarClientes(texto.trim()).catch(() => []));
    }, 250);
  }

  protected elegirCliente(c: ClienteBuscado): void {
    this.cliente.set(c);
    this.resultadosCliente.set([]);
    this.textoCliente.set('');
  }

  protected async crear(): Promise<void> {
    const valor = leerMonto(this.textoMonto);
    if (valor === null) return;
    this.enviando.set(true);
    this.error.set(null);
    try {
      await this.api.crearPedido({
        monto: valor,
        moneda: 'PEN',
        tienda: 'Tienda Central',
        caja: this.caja,
        clienteId: this.cliente()?.id ?? null,
      });
      this.textoMonto = '';
      this.cliente.set(null);
      await this.recargar();
    } catch (error) {
      this.error.set(mensajeError(error));
    } finally {
      this.enviando.set(false);
    }
  }

  protected async cancelar(p: Pedido): Promise<void> {
    this.cancelando.set(null);
    try {
      await this.api.cancelarPedido(p.id);
    } catch (error) {
      this.error.set(mensajeError(error));
    }
    await this.recargar();
  }
}
