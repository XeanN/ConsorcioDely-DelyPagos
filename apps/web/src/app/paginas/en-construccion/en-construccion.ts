import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MODULOS } from '../../core/auth/roles';

/** Página provisional de los módulos que se construyen en fases siguientes. */
@Component({
  selector: 'app-en-construccion',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center">
      <h2 class="text-xl font-bold text-slate-900">{{ modulo()?.titulo }}</h2>
      <p class="mt-2 text-slate-600">{{ modulo()?.descripcion }}</p>
      <p class="mt-4 text-sm text-slate-500">Se construye en la fase {{ modulo()?.fase }}.</p>
      <a routerLink="/" class="mt-6 inline-block text-sm font-medium text-slate-900 underline">Volver al inicio</a>
    </div>
  `,
})
export class EnConstruccion {
  /** Viene de `data.modulo` de la ruta (withComponentInputBinding). */
  readonly ruta = input.required<string>({ alias: 'modulo' });
  protected readonly modulo = computed(() => MODULOS.find((m) => m.ruta === this.ruta()));
}
