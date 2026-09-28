import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Rol } from './roles';

export interface UsuarioSesion {
  id: string;
  usuario: string;
  nombre: string;
  rol: Rol;
  debeCambiarClave: boolean;
}

interface RespuestaSesion {
  usuario: UsuarioSesion;
  accesoToken: string;
  accesoExpiraEn: string;
}

export const RUTA_AUTH = '/api/v1/auth';

/**
 * Sesión del usuario. El token de acceso vive solo en memoria (no en localStorage,
 * donde un script malicioso podría leerlo); la renovación usa una cookie HttpOnly.
 */
@Injectable({ providedIn: 'root' })
export class Sesion {
  private readonly http = inject(HttpClient);

  private readonly token = signal<string | null>(null);
  private readonly datos = signal<UsuarioSesion | null>(null);
  private renovacionEnCurso: Promise<boolean> | null = null;
  private temporizador: ReturnType<typeof setTimeout> | undefined;

  readonly usuario = this.datos.asReadonly();
  readonly autenticado = computed(() => this.datos() !== null);
  readonly debeCambiarClave = computed(() => this.datos()?.debeCambiarClave ?? false);

  accesoToken(): string | null {
    return this.token();
  }

  /** Devuelve null si entró, o el mensaje de error para mostrar. */
  async iniciarSesion(usuario: string, clave: string): Promise<string | null> {
    try {
      const respuesta = await firstValueFrom(
        this.http.post<RespuestaSesion>(`${RUTA_AUTH}/login`, { usuario, clave }),
      );
      this.aplicar(respuesta);
      return null;
    } catch (error) {
      return mensajeDeError(error);
    }
  }

  /** Intenta recuperar la sesión con la cookie (al abrir la app o si venció el token). */
  renovar(): Promise<boolean> {
    // Una sola renovación a la vez aunque varias peticiones reciban 401.
    this.renovacionEnCurso ??= firstValueFrom(
      this.http.post<RespuestaSesion>(`${RUTA_AUTH}/refrescar`, {}),
    )
      .then((respuesta) => {
        this.aplicar(respuesta);
        return true;
      })
      .catch(() => {
        this.limpiar();
        return false;
      })
      .finally(() => {
        this.renovacionEnCurso = null;
      });
    return this.renovacionEnCurso;
  }

  /** Devuelve null si se cambió, o el error y la lista de reglas incumplidas. */
  async cambiarClave(
    claveActual: string,
    claveNueva: string,
  ): Promise<{ error: string; problemas: string[] } | null> {
    try {
      const respuesta = await firstValueFrom(
        this.http.post<RespuestaSesion>(`${RUTA_AUTH}/cambiar-clave`, { claveActual, claveNueva }),
      );
      this.aplicar(respuesta);
      return null;
    } catch (error) {
      const problemas =
        error instanceof HttpErrorResponse && Array.isArray(error.error?.problemas)
          ? (error.error.problemas as string[])
          : [];
      return { error: mensajeDeError(error), problemas };
    }
  }

  async salir(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${RUTA_AUTH}/salir`, {}));
    } finally {
      this.limpiar();
    }
  }

  limpiar(): void {
    clearTimeout(this.temporizador);
    this.token.set(null);
    this.datos.set(null);
  }

  private aplicar(respuesta: RespuestaSesion): void {
    this.token.set(respuesta.accesoToken);
    this.datos.set(respuesta.usuario);
    // Renueva un minuto antes de que venza el token de acceso.
    clearTimeout(this.temporizador);
    const espera = new Date(respuesta.accesoExpiraEn).getTime() - Date.now() - 60_000;
    this.temporizador = setTimeout(() => void this.renovar(), Math.max(espera, 5_000));
  }
}

function mensajeDeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) return 'No se pudo conectar con el servidor. Verifique su conexión.';
    if (error.status === 429) return 'Demasiados intentos. Espere un minuto e intente de nuevo.';
    const mensaje = (error.error as { error?: unknown } | null)?.error;
    if (typeof mensaje === 'string') return mensaje;
  }
  return 'No se pudo iniciar sesión. Intente nuevamente.';
}
