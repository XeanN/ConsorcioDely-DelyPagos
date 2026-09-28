import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Rol } from '../../core/auth/roles';

export type RolAsignable = Exclude<Rol, 'INTEGRACION'>;

export interface Usuario {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  correo: string | null;
  telefono: string | null;
  activo: boolean;
  debeCambiarClave: boolean;
  bloqueadoHasta: string | null;
  ultimoIngresoEn: string | null;
  creadoEn: string;
}

export interface NuevoUsuario {
  usuario: string;
  nombre: string;
  rol: RolAsignable;
  claveTemporal: string;
  correo?: string | null;
  telefono?: string | null;
}

export class ErrorApi extends Error {
  constructor(
    mensaje: string,
    readonly problemas: string[] = [],
  ) {
    super(mensaje);
  }
}

const RUTA = '/api/v1/usuarios';

function aErrorApi(error: unknown): ErrorApi {
  if (error instanceof HttpErrorResponse) {
    const cuerpo = error.error as { error?: string; problemas?: string[]; message?: string } | null;
    return new ErrorApi(cuerpo?.error ?? 'No se pudo completar la operación.', cuerpo?.problemas ?? []);
  }
  return new ErrorApi('No se pudo completar la operación.');
}

@Injectable({ providedIn: 'root' })
export class UsuariosApi {
  private readonly http = inject(HttpClient);

  private async llamar<T>(peticion: Promise<T>): Promise<T> {
    try {
      return await peticion;
    } catch (error) {
      throw aErrorApi(error);
    }
  }

  listar(): Promise<Usuario[]> {
    return this.llamar(firstValueFrom(this.http.get<Usuario[]>(`${RUTA}/`)));
  }

  crear(datos: NuevoUsuario): Promise<Usuario> {
    return this.llamar(firstValueFrom(this.http.post<Usuario>(`${RUTA}/`, datos)));
  }

  actualizar(id: string, cambios: Partial<Pick<Usuario, 'nombre' | 'rol' | 'activo'>>): Promise<Usuario> {
    return this.llamar(firstValueFrom(this.http.patch<Usuario>(`${RUTA}/${id}`, cambios)));
  }

  restablecerClave(id: string, claveTemporal: string): Promise<void> {
    return this.llamar(
      firstValueFrom(this.http.post<void>(`${RUTA}/${id}/restablecer-clave`, { claveTemporal })),
    );
  }

  desbloquear(id: string): Promise<Usuario> {
    return this.llamar(firstValueFrom(this.http.post<Usuario>(`${RUTA}/${id}/desbloquear`, {})));
  }
}
