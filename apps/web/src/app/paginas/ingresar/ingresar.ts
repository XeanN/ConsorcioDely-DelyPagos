import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Sesion } from '../../core/auth/sesion';

@Component({
  selector: 'app-ingresar',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './ingresar.html',
})
export class Ingresar {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);

  protected readonly formulario = inject(NonNullableFormBuilder).group({
    usuario: ['', [Validators.required, Validators.maxLength(40)]],
    clave: ['', [Validators.required, Validators.maxLength(200)]],
  });

  protected readonly mostrarClave = signal(false);
  protected readonly bloqMayus = signal(false);
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected alternarClave(): void {
    this.mostrarClave.update((v) => !v);
  }

  protected detectarBloqMayus(evento: KeyboardEvent): void {
    this.bloqMayus.set(evento.getModifierState?.('CapsLock') ?? false);
  }

  protected async ingresar(): Promise<void> {
    if (this.formulario.invalid || this.enviando()) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    const { usuario, clave } = this.formulario.getRawValue();
    const error = await this.sesion.iniciarSesion(usuario, clave);
    this.enviando.set(false);
    if (error) {
      this.error.set(error);
      this.formulario.controls.clave.reset();
      return;
    }
    await this.router.navigate(['/']);
  }
}
