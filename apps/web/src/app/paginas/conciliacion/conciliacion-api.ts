import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Moneda } from '../../compartido/formato';
import type { Movimiento } from '../monitor/monitor-api';

export type EstadoConciliacion = 'CONCILIADO' | 'PROBABLE' | 'SIN_IDENTIFICAR' | 'DESCARTADO';
export type TipoDestino = 'PEDIDO' | 'COMPROBANTE';

export interface Candidato {
  tipo: TipoDestino;
  id: string;
  clienteId: string | null;
  descripcion: string;
  puntaje: number;
  montoAplicado: number;
  esParcial: boolean;
  motivos: string[];
}

export interface ItemBandeja {
  id: string;
  estado: EstadoConciliacion;
  puntaje: number;
  motivos: string[];
  candidatos: Candidato[];
  destino: { tipo: TipoDestino; id: string } | null;
  montoAplicado: number | null;
  confirmadoPor: string | null;
  confirmadoEn: string | null;
  movimiento: Movimiento;
}

export interface Explicacion {
  id: string;
  estado: EstadoConciliacion;
  puntaje: number;
  motivos: string[];
  candidatos: Candidato[];
  confirmadoPor: string | null;
  confirmadoEn: string | null;
}

export interface DestinoBuscado {
  tipo: TipoDestino;
  id: string;
  descripcion: string;
  pendiente: number;
  fecha: string;
}

export interface Pedido {
  id: string;
  tienda: string;
  caja: string;
  monto: number;
  moneda: Moneda;
  estado: 'ABIERTO' | 'PAGADO' | 'CANCELADO';
  cliente: string | null;
  creadoEn: string;
  cerradoEn: string | null;
}

export interface ClienteBuscado {
  id: string;
  nombre: string;
  tipoDoc: string;
  numeroDoc: string;
  tipo: string;
}

/** Mensaje de error legible que devuelve la API. */
export function mensajeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const mensaje = (error.error as { error?: string } | null)?.error;
    if (typeof mensaje === 'string') return mensaje;
    if (error.status === 403) return 'No tiene permiso para esta acción.';
  }
  return 'No se pudo completar la operación.';
}

@Injectable({ providedIn: 'root' })
export class ConciliacionApi {
  private readonly http = inject(HttpClient);

  bandeja(estado: EstadoConciliacion, fecha?: string) {
    const params: Record<string, string> = { estado };
    if (fecha) params['fecha'] = fecha;
    return firstValueFrom(this.http.get<ItemBandeja[]>('/api/v1/conciliaciones', { params }));
  }

  explicar(movimientoId: string) {
    return firstValueFrom(this.http.get<Explicacion>(`/api/v1/conciliaciones/movimiento/${movimientoId}`));
  }

  confirmar(conciliacionId: string, tipo: TipoDestino, destinoId: string) {
    return firstValueFrom(
      this.http.post<void>(`/api/v1/conciliaciones/${conciliacionId}/confirmar`, { tipo, destinoId }),
    );
  }

  descartar(conciliacionId: string, motivo: string) {
    return firstValueFrom(this.http.post<void>(`/api/v1/conciliaciones/${conciliacionId}/descartar`, { motivo }));
  }

  procesar(fecha: string) {
    return firstValueFrom(this.http.post<{ procesados: number }>('/api/v1/conciliaciones/procesar', { fecha }));
  }

  buscarDestinos(q: string, moneda: Moneda) {
    return firstValueFrom(
      this.http.get<DestinoBuscado[]>('/api/v1/conciliaciones/destinos', { params: { q, moneda } }),
    );
  }

  pedidos(estado: Pedido['estado'] = 'ABIERTO') {
    return firstValueFrom(this.http.get<Pedido[]>('/api/v1/pedidos', { params: { estado } }));
  }

  crearPedido(datos: { monto: number; moneda: Moneda; tienda: string; caja: string; clienteId: string | null }) {
    return firstValueFrom(this.http.post<{ id: string }>('/api/v1/pedidos', datos));
  }

  cancelarPedido(id: string) {
    return firstValueFrom(this.http.post<void>(`/api/v1/pedidos/${id}/cancelar`, {}));
  }

  buscarClientes(q: string) {
    return firstValueFrom(this.http.get<ClienteBuscado[]>('/api/v1/clientes', { params: { q } }));
  }
}
