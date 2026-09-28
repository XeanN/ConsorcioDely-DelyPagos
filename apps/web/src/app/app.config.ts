import {
  type ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import * as Sentry from '@sentry/angular';

import { routes } from './app.routes';
import { Configuracion } from './core/configuracion';
import { iniciarSentry } from './core/sentry';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler({ showDialog: false }) },
    provideAppInitializer(async () => {
      const configuracion = inject(Configuracion);
      await configuracion.cargar();
      iniciarSentry(configuracion.valor());
    }),
  ],
};
