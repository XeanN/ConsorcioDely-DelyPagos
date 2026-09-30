import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal, type OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

interface Integracion {
  id: string;
  nombre: string;
  clientId: string;
  alcances: string[];
  activo: boolean;
  ultimoUsoEn: string | null;
  creadoEn: string;
}

interface CredencialNueva {
  nombre: string;
  clientId: string;
  clientSecret: string;
}

const RUTA = '/api/v1/integraciones';

/** El admin da acceso a sistemas externos (el ERP) con OAuth2 client credentials. */
@Component({
  selector: 'app-integraciones',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './integraciones.html',
})
export class Integraciones implements OnInit {
  private readonly http = inject(HttpClient);

  protected readonly integraciones = signal<Integracion[]>([]);
  protected readonly alcancesDisponibles = signal<[string, string][]>([]);
  protected readonly credencial = signal<CredencialNueva | null>(null);
  protected readonly copiado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly confirmando = signal<{ id: string; accion: 'revocar' | 'regenerar-secreto' } | null>(null);
  protected nombre = '';
  protected elegidos = new Set<string>(['pedidos']);

  async ngOnInit(): Promise<void> {
    await this.recargar();
  }

  protected alternarAlcance(alcance: string): void {
    const copia = new Set(this.elegidos);
    if (copia.has(alcance)) copia.delete(alcance);
    else copia.add(alcance);
    this.elegidos = copia;
  }

  protected fecha(valor: string | null): string {
    return valor ? new Date(valor).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca';
  }

  protected async crear(): Promise<void> {
    if (this.nombre.trim().length < 3 || this.elegidos.size === 0) return;
    await this.ejecutar(async () => {
      const r = await firstValueFrom(
        this.http.post<{ integracion: Integracion; clientSecret: string }>(RUTA, {
          nombre: this.nombre.trim(),
          alcances: [...this.elegidos],
        }),
      );
      this.mostrarCredencial(r.integracion.nombre, r.integracion.clientId, r.clientSecret);
      this.nombre = '';
    });
  }

  protected async confirmar(i: Integracion): Promise<void> {
    const accion = this.confirmando()?.accion;
    this.confirmando.set(null);
    if (accion === 'regenerar-secreto') {
      await this.ejecutar(async () => {
        const r = await firstValueFrom(
          this.http.post<{ clientId: string; clientSecret: string }>(`${RUTA}/${i.id}/regenerar-secreto`, {}),
        );
        this.mostrarCredencial(i.nombre, r.clientId, r.clientSecret);
      });
    } else if (accion === 'revocar') {
      await this.ejecutar(() => firstValueFrom(this.http.post(`${RUTA}/${i.id}/revocar`, {})));
    }
  }

  protected async activar(i: Integracion): Promise<void> {
    await this.ejecutar(() => firstValueFrom(this.http.post(`${RUTA}/${i.id}/activar`, {})));
  }

  protected async copiar(texto: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(texto);
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2_000);
    } catch {
      this.copiado.set(false);
    }
  }

  private mostrarCredencial(nombre: string, clientId: string, clientSecret: string): void {
    this.credencial.set({ nombre, clientId, clientSecret });
    this.copiado.set(false);
  }

  private async recargar(): Promise<void> {
    const r = await firstValueFrom(
      this.http.get<{ integraciones: Integracion[]; alcancesDisponibles: Record<string, string> }>(RUTA),
    );
    this.integraciones.set(r.integraciones);
    this.alcancesDisponibles.set(Object.entries(r.alcancesDisponibles));
  }

  private async ejecutar(operacion: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    try {
      await operacion();
    } catch (error) {
      const mensaje = error instanceof HttpErrorResponse ? (error.error as { error?: string })?.error : null;
      this.error.set(mensaje ?? 'No se pudo completar la operación.');
    } finally {
      this.ocupado.set(false);
      await this.recargar().catch(() => undefined);
    }
  }
}
