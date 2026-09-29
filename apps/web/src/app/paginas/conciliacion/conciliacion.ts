import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, viewChild } from '@angular/core';
import { EnVivo } from '../../core/en-vivo/en-vivo';
import { Sesion } from '../../core/auth/sesion';
import { BandejaConciliacion } from './bandeja';
import { PedidosCaja } from './pedidos-caja';

@Component({
  selector: 'app-conciliacion',
  imports: [PedidosCaja, BandejaConciliacion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="text-2xl font-bold text-slate-900">Conciliación</h2>
    <p class="mt-1 text-slate-600">
      Cada abono se cruza automáticamente con los pedidos en caja y las facturas pendientes. Aquí se confirman los
      casos dudosos.
    </p>
    <div class="mt-5 space-y-5">
      <app-pedidos-caja />
      <app-bandeja-conciliacion [puedeProcesar]="esFinanzas()" />
    </div>
  `,
})
export class Conciliacion {
  private readonly pedidos = viewChild(PedidosCaja);
  private readonly bandeja = viewChild(BandejaConciliacion);
  private readonly sesion = inject(Sesion);
  protected readonly esFinanzas = computed(() => ['FINANZAS', 'ADMIN'].includes(this.sesion.usuario()?.rol ?? ''));
  private espera: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Una sola conexión en vivo para la página: cualquier pago nuevo o conciliado refresca ambas vistas.
    const cerrar = inject(EnVivo).conectar('/api/v1/movimientos/en-vivo', (evento) => {
      if (evento !== 'movimiento-actualizado') return;
      clearTimeout(this.espera);
      this.espera = setTimeout(() => {
        void this.pedidos()?.recargar();
        void this.bandeja()?.recargar();
      }, 300);
    });
    inject(DestroyRef).onDestroy(() => {
      cerrar();
      clearTimeout(this.espera);
    });
  }
}
