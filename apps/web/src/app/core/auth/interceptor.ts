import type { HttpInterceptorFn } from '@angular/common/http';
import { HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { RUTA_AUTH, Sesion } from './sesion';

const RUTAS_SIN_TOKEN = [`${RUTA_AUTH}/login`, `${RUTA_AUTH}/refrescar`, `${RUTA_AUTH}/salir`];

/** Adjunta el token a las llamadas a la API y renueva la sesión una vez si vence. */
export const interceptorAuth: HttpInterceptorFn = (peticion, siguiente) => {
  // Solo la API propia recibe el token; nunca un dominio externo.
  if (!peticion.url.startsWith('/api/') || RUTAS_SIN_TOKEN.includes(peticion.url)) {
    return siguiente(peticion);
  }
  const sesion = inject(Sesion);
  const router = inject(Router);

  const conToken = () => {
    const token = sesion.accesoToken();
    return token ? peticion.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : peticion;
  };

  return siguiente(conToken()).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return from(sesion.renovar()).pipe(
        switchMap((renovada) => {
          if (renovada) return siguiente(conToken());
          void router.navigate(['/ingresar']);
          return throwError(() => error);
        }),
      );
    }),
  );
};
