import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Moneda } from '../../compartido/formato';

export type Canal = 'TRANSFERENCIA' | 'INTERBANCARIA' | 'YAPE' | 'PLIN' | 'DEPOSITO_AGENCIA';
export type EstadoMovimiento = 'POR_CONCILIAR' | 'CONCILIADO' | 'PROBABLE' | 'SIN_IDENTIFICAR' | 'DESCARTADO';

export interface Movimiento {
  id: string;
  idBanco: string;
  cuentaId: string;
  banco: string;
  fechaHora: string;
  monto: number;
  moneda: Moneda;
  canal: Canal;
  numeroOperacion: string;
  ordenanteNombre: string | null;
  ordenanteTipoDoc: 'DNI' | 'RUC' | 'CE' | null;
  ordenanteNumeroDoc: string | null;
  ordenanteBanco: string | null;
  ordenanteCuenta: string | null;
  referencia: string | null;
  estado: EstadoMovimiento;
}

export interface Filtros {
  fecha: string;
  cuentaId: string;
  canal: Canal | '';
  estado: EstadoMovimiento | '';
  q: string;
  monto: number | null;
}

export interface Resumen {
  fecha: string;
  porCanal: { canal: Canal; moneda: Moneda; cantidad: number; total: number }[];
  totales: { moneda: Moneda; cantidad: number; total: number }[];
}

export interface CuentaDely {
  id: string;
  banco: string;
  numero: string;
  moneda: Moneda;
  descripcion: string | null;
}

@Injectable({ providedIn: 'root' })
export class MonitorApi {
  private readonly http = inject(HttpClient);

  listar(filtros: Filtros, antesDe?: string, limite = 100) {
    let params = new HttpParams().set('fecha', filtros.fecha).set('limite', limite);
    if (filtros.cuentaId) params = params.set('cuentaId', filtros.cuentaId);
    if (filtros.canal) params = params.set('canal', filtros.canal);
    if (filtros.estado) params = params.set('estado', filtros.estado);
    if (filtros.q.trim().length >= 2) params = params.set('q', filtros.q.trim());
    if (filtros.monto !== null) params = params.set('monto', filtros.monto);
    if (antesDe) params = params.set('antesDe', antesDe);
    return firstValueFrom(
      this.http.get<{ items: Movimiento[]; siguienteCursor: string | null }>('/api/v1/movimientos', { params }),
    );
  }

  resumen(fecha: string) {
    return firstValueFrom(this.http.get<Resumen>('/api/v1/movimientos/resumen', { params: { fecha } }));
  }

  cuentas() {
    return firstValueFrom(this.http.get<CuentaDely[]>('/api/v1/cuentas'));
  }
}
