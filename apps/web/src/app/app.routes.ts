import type { Routes } from '@angular/router';
import { autenticadoGuard, invitadoGuard, rolGuard } from './core/auth/guards';
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
    loadComponent: () => import('./paginas/marco/marco').then((m) => m.Marco),
    children: [
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
          import('./paginas/en-construccion/en-construccion').then((m) => m.EnConstruccion),
      })),
    ],
  },
  { path: '**', redirectTo: '' },
];
