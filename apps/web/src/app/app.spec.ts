import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { Configuracion, type ConfiguracionPublica } from './core/configuracion';

function configurar(valor: Partial<ConfiguracionPublica>) {
  TestBed.inject(Configuracion).valor.set({
    modoDemo: true,
    proveedorBancario: 'mock',
    sentryDsn: null,
    entorno: 'test',
    ...valor,
  });
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideRouter([])],
    }).compileComponents();
  });

  it('muestra el banner de demostración con el proveedor mock', async () => {
    configurar({ modoDemo: true });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'Modo demostración — datos simulados',
    );
  });

  it('oculta el banner con un proveedor real', async () => {
    configurar({ modoDemo: false, proveedorBancario: 'bcp-rest' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Modo demostración');
  });
});
