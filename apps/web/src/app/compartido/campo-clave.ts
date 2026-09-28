import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { type FormControl, ReactiveFormsModule } from '@angular/forms';

/** Campo de contraseña con botón para mostrarla u ocultarla y aviso de Bloq Mayús. */
@Component({
  selector: 'app-campo-clave',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [for]="idCampo()" class="mb-1.5 block text-sm font-semibold text-slate-800">{{ etiqueta() }}</label>
    <div class="relative">
      <input
        [id]="idCampo()"
        [type]="visible() ? 'text' : 'password'"
        [formControl]="control()"
        [attr.autocomplete]="autocompletar()"
        autocapitalize="none"
        spellcheck="false"
        class="block w-full rounded-lg border border-slate-400 bg-white py-2.5 pr-12 pl-3 text-base text-black focus:border-slate-900 focus:ring-2 focus:ring-slate-900/20 focus:outline-none"
        (keydown)="detectarBloqMayus($event)"
        (keyup)="detectarBloqMayus($event)"
      />
      <button
        type="button"
        class="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-slate-600 hover:text-black focus:ring-2 focus:ring-slate-900/30 focus:outline-none"
        (click)="visible.set(!visible())"
        [attr.aria-label]="visible() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
        [attr.aria-pressed]="visible()"
        [title]="visible() ? 'Ocultar contraseña' : 'Mostrar contraseña'"
      >
        @if (visible()) {
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.8 9.8 0 0112 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.6 3.7M6.6 6.6C4.4 8 2.8 10.1 2 12c1 2.5 5 7 10 7 1.8 0 3.4-.5 4.8-1.3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        } @else {
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M2 12c1-2.5 5-7 10-7s9 4.5 10 7c-1 2.5-5 7-10 7S3 14.5 2 12z" stroke-linejoin="round" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      </button>
    </div>
    @if (bloqMayus()) {
      <p class="mt-1 text-sm font-medium text-amber-700">Bloq Mayús está activado.</p>
    }
  `,
})
export class CampoClave {
  readonly control = input.required<FormControl<string>>();
  readonly etiqueta = input.required<string>();
  readonly idCampo = input.required<string>();
  readonly autocompletar = input<'current-password' | 'new-password' | 'off'>('current-password');

  protected readonly visible = signal(false);
  protected readonly bloqMayus = signal(false);

  protected detectarBloqMayus(evento: KeyboardEvent): void {
    this.bloqMayus.set(evento.getModifierState?.('CapsLock') ?? false);
  }
}
