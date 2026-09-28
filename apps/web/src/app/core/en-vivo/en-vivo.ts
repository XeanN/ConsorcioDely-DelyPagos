import { Injectable, inject, signal } from '@angular/core';
import { Sesion } from '../auth/sesion';
import { parsearSse } from './sse';

export type EstadoConexion = 'desconectado' | 'conectando' | 'en-vivo' | 'reconectando';

/**
 * Conexión en vivo (Server-Sent Events) con la API. Usa fetch para enviar el token en la
 * cabecera Authorization: EventSource no lo permite y ponerlo en la URL lo expondría en registros.
 */
@Injectable({ providedIn: 'root' })
export class EnVivo {
  private readonly sesion = inject(Sesion);

  readonly estado = signal<EstadoConexion>('desconectado');

  /** Abre la conexión y llama a `alRecibir` por cada evento. Devuelve la función para cerrarla. */
  conectar(ruta: string, alRecibir: (evento: string, datos: unknown) => void): () => void {
    let activo = true;
    let controlador: AbortController | undefined;
    let espera: ReturnType<typeof setTimeout> | undefined;
    let intentos = 0;

    const reintentar = () => {
      if (!activo) return;
      this.estado.set('reconectando');
      // Espera creciente (1 s, 2 s, 4 s… hasta 30 s) para no saturar el servidor si está caído.
      const demora = Math.min(30_000, 1_000 * 2 ** intentos++);
      espera = setTimeout(() => void abrir(), demora);
    };

    const abrir = async () => {
      if (!activo) return;
      this.estado.set(intentos === 0 ? 'conectando' : 'reconectando');
      controlador = new AbortController();
      try {
        const token = this.sesion.accesoToken();
        const respuesta = await fetch(ruta, {
          headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          signal: controlador.signal,
          cache: 'no-store',
        });
        if (respuesta.status === 401) {
          if (await this.sesion.renovar()) return void abrir();
          this.estado.set('desconectado');
          return;
        }
        if (!respuesta.ok || !respuesta.body) throw new Error(`HTTP ${respuesta.status}`);

        const lector = respuesta.body.getReader();
        const decodificador = new TextDecoder();
        let pendiente = '';
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          const { eventos, resto } = parsearSse(pendiente + decodificador.decode(value, { stream: true }));
          pendiente = resto;
          for (const { evento, datos } of eventos) {
            if (evento === 'conectado') {
              intentos = 0;
              this.estado.set('en-vivo');
            }
            try {
              alRecibir(evento, JSON.parse(datos));
            } catch {
              // Un evento malformado no corta la conexión.
            }
          }
        }
        // El servidor cerró (p. ej. token por vencer): reconectar de inmediato con uno nuevo.
        if (activo) {
          intentos = 0;
          await this.sesion.renovar();
          void abrir();
        }
      } catch {
        if (activo && !controlador?.signal.aborted) reintentar();
      }
    };

    void abrir();
    return () => {
      activo = false;
      clearTimeout(espera);
      controlador?.abort();
      this.estado.set('desconectado');
    };
  }
}
