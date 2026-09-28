import { EventEmitter } from 'node:events';
import type { MovimientoVista } from '../movimientos/vista.js';

export interface EventosDely {
  'movimiento.registrado': MovimientoVista;
}

type Oyente<K extends keyof EventosDely> = (datos: EventosDely[K]) => void;

/**
 * Bus de eventos dentro del proceso: la ingesta publica y las conexiones SSE escuchan.
 * Si más adelante hay varias instancias de la API, se reemplaza por PostgreSQL LISTEN/NOTIFY
 * sin cambiar a quienes lo usan.
 */
export class BusEventos {
  private readonly emisor = new EventEmitter();

  constructor() {
    // Cada pantalla abierta es un oyente; no hay un límite razonable fijo.
    this.emisor.setMaxListeners(0);
  }

  on<K extends keyof EventosDely>(evento: K, oyente: Oyente<K>): () => void {
    this.emisor.on(evento, oyente);
    return () => this.emisor.off(evento, oyente);
  }

  emit<K extends keyof EventosDely>(evento: K, datos: EventosDely[K]): void {
    this.emisor.emit(evento, datos);
  }

  oyentes(evento: keyof EventosDely): number {
    return this.emisor.listenerCount(evento);
  }
}
