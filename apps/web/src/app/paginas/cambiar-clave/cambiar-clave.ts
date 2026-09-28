import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Sesion } from '../../core/auth/sesion';
import { CampoClave } from '../../compartido/campo-clave';
import { evaluarClave } from '../../compartido/politica-clave';

@Component({
  selector: 'app-cambiar-clave',
  imports: [ReactiveFormsModule, CampoClave],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cambiar-clave.html',
})
export class CambiarClave {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly obligatorio = this.sesion.debeCambiarClave;
  protected readonly formulario = inject(NonNullableFormBuilder).group({
    actual: ['', Validators.required],
    nueva: ['', Validators.required],
    confirmacion: ['', Validators.required],
  });

  private readonly valores = toSignal(this.formulario.valueChanges, {
    initialValue: this.formulario.getRawValue(),
  });
  protected readonly reglas = computed(() =>
    evaluarClave(this.valores().nueva ?? '', this.sesion.usuario()?.usuario ?? ''),
  );
  protected readonly coinciden = computed(
    () => !!this.valores().nueva && this.valores().nueva === this.valores().confirmacion,
  );
  protected readonly listo = computed(
    () => this.reglas().every((r) => r.cumple) && this.coinciden() && !!this.valores().actual,
  );

  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly problemas = signal<string[]>([]);
  protected readonly exito = signal(false);

  protected async guardar(): Promise<void> {
    if (!this.listo() || this.enviando()) return;
    this.enviando.set(true);
    this.error.set(null);
    this.problemas.set([]);
    const { actual, nueva } = this.formulario.getRawValue();
    const resultado = await this.sesion.cambiarClave(actual, nueva);
    this.enviando.set(false);
    if (resultado) {
      this.error.set(resultado.error);
      this.problemas.set(resultado.problemas);
      return;
    }
    this.formulario.reset();
    this.exito.set(true);
    setTimeout(() => void this.router.navigate(['/']), 1500);
  }
}
