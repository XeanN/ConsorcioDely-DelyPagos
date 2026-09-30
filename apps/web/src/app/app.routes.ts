import type { Routes } from '@angular/router';
import { autenticadoGuard, claveAlDiaGuard, invitadoGuard, rolGuard } from './core/auth/guards';
import { MODULOS } from './core/auth/roles';

export const routes: Routes = [
  {
    path: 'ingresar',
    title: 'Ingresar · Dely Pagos',
    canActivate: [invitadoGuard],
    loadComponent: () => import('./paginas/ingresar/ingresar').then((m) => m.Ingresar),
  },
  {
    path: '',
    canActivate: [autenticadoGuard],
    canActivateChild: [claveAlDiaGuard],
    loadComponent: () => import('./paginas/marco/marco').then((m) => m.Marco),
    children: [
      {
        path: 'cambiar-clave',
        title: 'Cambiar contraseña · Dely Pagos',
        loadComponent: () =>
          import('./paginas/cambiar-clave/cambiar-clave').then((m) => m.CambiarClave),
      },
      {
        path: 'usuarios',
        title: 'Usuarios · Dely Pagos',
        canActivate: [rolGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () => import('./paginas/usuarios/usuarios').then((m) => m.Usuarios),
      },
      {
        path: 'integraciones',
        title: 'Integraciones · Dely Pagos',
        canActivate: [rolGuard],
        data: { roles: ['ADMIN'] },
        loadComponent: () => import('./paginas/integraciones/integraciones').then((m) => m.Integraciones),
      },
      {
        path: '',
        title: 'Inicio · Dely Pagos',
        loadComponent: () => import('./paginas/inicio/inicio').then((m) => m.Inicio),
      },
      ...MODULOS.map((modulo) => ({
        path: modulo.ruta,
        title: `${modulo.titulo} · Dely Pagos`,
        canActivate: [rolGuard],
        data: { roles: modulo.roles, modulo: modulo.ruta },
        loadComponent: () =>
          modulo.ruta === 'monitor'
            ? import('./paginas/monitor/monitor').then((m) => m.Monitor)
            : modulo.ruta === 'conciliacion'
              ? import('./paginas/conciliacion/conciliacion').then((m) => m.Conciliacion)
              : import('./paginas/en-construccion/en-construccion').then((m) => m.EnConstruccion),
      })),
    ],
  },
  { path: '**', redirectTo: '' },
];
