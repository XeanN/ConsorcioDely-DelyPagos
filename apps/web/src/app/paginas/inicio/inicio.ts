import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ETIQUETA_ROL, MODULOS, puedeVer } from '../../core/auth/roles';
import { Sesion } from '../../core/auth/sesion';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="text-2xl font-bold text-slate-900">Hola, {{ usuario()?.nombre }}</h2>
    <p class="mt-1 text-slate-600">
      Perfil: <strong class="text-slate-800">{{ etiquetaRol() }}</strong>. Estos son sus módulos:
    </p>

    <div class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      @for (modulo of modulos(); track modulo.ruta) {
        <a
          [routerLink]="['/', modulo.ruta]"
          class="block rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-400 hover:shadow"
        >
          <div class="flex items-start justify-between gap-3">
            <h3 class="font-semibold text-slate-900">{{ modulo.titulo }}</h3>
            <span class="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {{ modulo.fase }}
            </span>
          </div>
          <p class="mt-2 text-sm text-slate-600">{{ modulo.descripcion }}</p>
        </a>
      }
    </div>
  `,
})
export class Inicio {
  private readonly sesion = inject(Sesion);
  protected readonly usuario = this.sesion.usuario;
  protected readonly etiquetaRol = computed(() => {
    const rol = this.usuario()?.rol;
    return rol ? ETIQUETA_ROL[rol] : '';
  });
  protected readonly modulos = computed(() =>
    MODULOS.filter((m) => puedeVer(this.usuario()?.rol, m.roles)),
  );
}
