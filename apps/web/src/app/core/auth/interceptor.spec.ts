import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { interceptorAuth } from './interceptor';
import { Sesion } from './sesion';

describe('interceptorAuth', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  const sesion = { accesoToken: vi.fn<() => string | null>(), renovar: vi.fn<() => Promise<boolean>>() };

  beforeEach(() => {
    sesion.accesoToken.mockReset().mockReturnValue('token-1');
    sesion.renovar.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([interceptorAuth])),
        provideHttpClientTesting(),
        { provide: Sesion, useValue: sesion },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  it('adjunta el token a las llamadas de la API', async () => {
    const respuesta = firstValueFrom(http.get('/api/v1/movimientos'));
    const peticion = backend.expectOne('/api/v1/movimientos');
    expect(peticion.request.headers.get('Authorization')).toBe('Bearer token-1');
    peticion.flush([]);
    await respuesta;
  });

  it('nunca envía el token a dominios externos', async () => {
    const respuesta = firstValueFrom(http.get('https://otro-sitio.example/datos'));
    const peticion = backend.expectOne('https://otro-sitio.example/datos');
    expect(peticion.request.headers.has('Authorization')).toBe(false);
    peticion.flush({});
    await respuesta;
  });

  it('renueva la sesión una vez ante un 401 y reintenta', async () => {
    sesion.renovar.mockImplementation(async () => {
      sesion.accesoToken.mockReturnValue('token-2');
      return true;
    });
    const respuesta = firstValueFrom(http.get('/api/v1/movimientos'));
    backend.expectOne('/api/v1/movimientos').flush({}, { status: 401, statusText: 'No autorizado' });
    await Promise.resolve();
    await new Promise((r) => setTimeout(r));
    const reintento = backend.expectOne('/api/v1/movimientos');
    expect(reintento.request.headers.get('Authorization')).toBe('Bearer token-2');
    reintento.flush({ ok: true });
    expect(await respuesta).toEqual({ ok: true });
  });

  it('manda a la pantalla de ingreso si la sesión no se puede renovar', async () => {
    sesion.renovar.mockResolvedValue(false);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const respuesta = firstValueFrom(http.get('/api/v1/movimientos'));
    backend.expectOne('/api/v1/movimientos').flush({}, { status: 401, statusText: 'No autorizado' });
    await expect(respuesta).rejects.toBeTruthy();
    expect(navegar).toHaveBeenCalledWith(['/ingresar']);
  });
});
