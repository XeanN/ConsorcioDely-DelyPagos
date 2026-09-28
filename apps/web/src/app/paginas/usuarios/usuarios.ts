import { ChangeDetectionStrategy, Component, computed, inject, signal, type OnInit } from '@angular/core';
import { FormControl, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ETIQUETA_ROL } from '../../core/auth/roles';
import { Sesion } from '../../core/auth/sesion';
import { CampoClave } from '../../compartido/campo-clave';
import { generarClaveTemporal } from '../../compartido/politica-clave';
import { ErrorApi, UsuariosApi, type RolAsignable, type Usuario } from './usuarios-api';

type Accion = { id: string; tipo: 'restablecer' | 'desactivar' } | null;

@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule, CampoClave],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './usuarios.html',
})
export class Usuarios implements OnInit {
  private readonly api = inject(UsuariosApi);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly sesion = inject(Sesion);
  protected readonly miId = computed(() => this.sesion.usuario()?.id);

  protected readonly roles: { valor: RolAsignable; etiqueta: string }[] = (
    ['CAJA', 'VENTAS', 'FINANZAS', 'ADMIN'] as const
  ).map((valor) => ({ valor, etiqueta: ETIQUETA_ROL[valor] }));
  protected readonly etiquetaRol = ETIQUETA_ROL;

  protected readonly usuarios = signal<Usuario[]>([]);
  protected readonly cargando = signal(true);
  protected readonly ocupado = signal(false);
  protected readonly aviso = signal<string | null>(null);
  protected readonly error = signal<ErrorApi | null>(null);
  protected readonly mostrarNuevo = signal(false);
  protected readonly accion = signal<Accion>(null);

  protected readonly nuevo = this.fb.group({
    usuario: ['', [Validators.required, Validators.pattern(/^[a-zA-Z][a-zA-Z0-9._-]{2,39}$/)]],
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    rol: this.fb.control<RolAsignable>('CAJA'),
    claveTemporal: ['', Validators.required],
  });
  protected readonly claveRestablecer = new FormControl('', { nonNullable: true });

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  protected estado(u: Usuario): { texto: string; clase: string } {
    if (!u.activo) return { texto: 'Inactivo', clase: 'bg-slate-200 text-slate-700' };
    if (u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date()) {
      return { texto: 'Bloqueado', clase: 'bg-red-100 text-red-800' };
    }
    if (u.debeCambiarClave) return { texto: 'Clave temporal', clase: 'bg-amber-100 text-amber-900' };
    return { texto: 'Activo', clase: 'bg-emerald-100 text-emerald-800' };
  }

  protected estaBloqueado(u: Usuario): boolean {
    return !!u.bloqueadoHasta && new Date(u.bloqueadoHasta) > new Date();
  }

  protected fecha(valor: string | null): string {
    return valor
      ? new Date(valor).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })
      : 'Nunca';
  }

  protected generar(control: FormControl<string>): void {
    control.setValue(generarClaveTemporal());
  }

  protected async crear(): Promise<void> {
    if (this.nuevo.invalid) {
      this.nuevo.markAllAsTouched();
      return;
    }
    const datos = this.nuevo.getRawValue();
    const creado = await this.ejecutar(() => this.api.crear(datos));
    if (creado) {
      this.aviso.set(
        `Usuario "${creado.usuario}" creado. Entréguele la contraseña temporal por un medio seguro (en persona o por teléfono); deberá cambiarla al ingresar.`,
      );
      this.nuevo.reset({ usuario: '', nombre: '', rol: 'CAJA', claveTemporal: '' });
      this.mostrarNuevo.set(false);
      await this.recargar();
    }
  }

  protected async cambiarRol(u: Usuario, evento: Event): Promise<void> {
    const rol = (evento.target as HTMLSelectElement).value as RolAsignable;
    if (rol === u.rol) return;
    const ok = await this.ejecutar(() => this.api.actualizar(u.id, { rol }));
    if (ok) this.aviso.set(`Rol de "${u.usuario}" cambiado a ${ETIQUETA_ROL[rol]}. Sus sesiones se cerraron.`);
    await this.recargar();
  }

  protected abrir(id: string, tipo: 'restablecer' | 'desactivar'): void {
    this.claveRestablecer.setValue('');
    this.accion.set({ id, tipo });
  }

  protected async confirmarDesactivar(u: Usuario): Promise<void> {
    const ok = await this.ejecutar(() => this.api.actualizar(u.id, { activo: false }));
    this.accion.set(null);
    if (ok) this.aviso.set(`"${u.usuario}" fue desactivado y sus sesiones se cerraron.`);
    await this.recargar();
  }

  protected async activar(u: Usuario): Promise<void> {
    const ok = await this.ejecutar(() => this.api.actualizar(u.id, { activo: true }));
    if (ok) this.aviso.set(`"${u.usuario}" fue activado.`);
    await this.recargar();
  }

  protected async confirmarRestablecer(u: Usuario): Promise<void> {
    const clave = this.claveRestablecer.value;
    if (!clave) return;
    const ok = await this.ejecutar(() => this.api.restablecerClave(u.id, clave).then(() => true));
    if (ok) {
      this.accion.set(null);
      this.aviso.set(
        `Contraseña temporal asignada a "${u.usuario}". Entréguesela por un medio seguro; deberá cambiarla al ingresar.`,
      );
      await this.recargar();
    }
  }

  protected async desbloquear(u: Usuario): Promise<void> {
    const ok = await this.ejecutar(() => this.api.desbloquear(u.id));
    if (ok) this.aviso.set(`"${u.usuario}" fue desbloqueado.`);
    await this.recargar();
  }

  private async recargar(): Promise<void> {
    try {
      this.usuarios.set(await this.api.listar());
    } catch (error) {
      this.error.set(error as ErrorApi);
    } finally {
      this.cargando.set(false);
    }
  }

  private async ejecutar<T>(operacion: () => Promise<T>): Promise<T | null> {
    this.ocupado.set(true);
    this.aviso.set(null);
    this.error.set(null);
    try {
      return await operacion();
    } catch (error) {
      this.error.set(error instanceof ErrorApi ? error : new ErrorApi('No se pudo completar la operación.'));
      return null;
    } finally {
      this.ocupado.set(false);
    }
  }
}
