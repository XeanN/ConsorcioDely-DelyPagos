import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import * as Sentry from '@sentry/angular';

import { routes } from './app.routes';
import { interceptorAuth } from './core/auth/interceptor';
import { Sesion } from './core/auth/sesion';
import { Configuracion } from './core/configuracion';
import { iniciarSentry } from './core/sentry';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([interceptorAuth])),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler({ showDialog: false }) },
    provideAppInitializer(async () => {
      const configuracion = inject(Configuracion);
      const sesion = inject(Sesion);
      await configuracion.cargar();
      iniciarSentry(configuracion.valor());
      // Si hay cookie de sesión válida, el usuario entra sin volver a escribir su clave.
      await sesion.renovar();
    }),
  ],
};
