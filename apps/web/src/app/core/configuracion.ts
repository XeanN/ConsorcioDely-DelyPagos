import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export interface ConfiguracionPublica {
  modoDemo: boolean;
  proveedorBancario: 'mock' | 'bcp-rest' | 'bcp-h2h';
  sentryDsn: string | null;
  entorno: string;
}

/** Configuración que entrega la API al arrancar; evita recompilar la web por entorno. */
@Injectable({ providedIn: 'root' })
export class Configuracion {
  private readonly http = inject(HttpClient);

  readonly valor = signal<ConfiguracionPublica | null>(null);
  readonly error = signal<string | null>(null);

  async cargar(): Promise<void> {
    try {
      this.valor.set(
        await firstValueFrom(this.http.get<ConfiguracionPublica>('/api/v1/configuracion-publica')),
      );
    } catch {
      this.error.set('No se pudo conectar con la API.');
    }
  }
}
