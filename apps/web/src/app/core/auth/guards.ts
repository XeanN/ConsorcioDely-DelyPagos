import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { puedeVer, type Rol } from './roles';
import { Sesion } from './sesion';

/** Solo usuarios con sesión. Los permisos reales los aplica la API. */
export const autenticadoGuard: CanActivateFn = () => {
  const sesion = inject(Sesion);
  return sesion.autenticado() || inject(Router).createUrlTree(['/ingresar']);
};

/** La pantalla de ingreso no se muestra a quien ya inició sesión. */
export const invitadoGuard: CanActivateFn = () => {
  const sesion = inject(Sesion);
  return !sesion.autenticado() || inject(Router).createUrlTree(['/']);
};

/** Restringe una ruta a los roles indicados en `data.roles`. */
export const rolGuard: CanActivateFn = (ruta) => {
  const roles = (ruta.data['roles'] ?? []) as Rol[];
  return puedeVer(inject(Sesion).usuario()?.rol, roles) || inject(Router).createUrlTree(['/']);
};

/** Mientras la contraseña sea temporal, solo se permite la pantalla para cambiarla. */
export const claveAlDiaGuard: CanActivateFn = (_ruta, estado) => {
  const sesion = inject(Sesion);
  if (!sesion.debeCambiarClave() || estado.url.startsWith('/cambiar-clave')) return true;
  return inject(Router).createUrlTree(['/cambiar-clave']);
};
