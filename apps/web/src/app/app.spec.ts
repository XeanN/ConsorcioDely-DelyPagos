import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { Configuracion, type ConfiguracionPublica } from './core/configuracion';
import { provideHttpClient } from '@angular/common/http';

function configurar(valor: Partial<ConfiguracionPublica>) {
  const configuracion = TestBed.inject(Configuracion);
  configuracion.valor.set({
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
      providers: [provideHttpClient()],
    }).compileComponents();
  });

  it('muestra el banner de demostración con el proveedor mock', async () => {
    configurar({ modoDemo: true });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).toContain('Modo demostración — datos simulados');
  });

  it('oculta el banner con un proveedor real', async () => {
    configurar({ modoDemo: false, proveedorBancario: 'bcp-rest' });
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.textContent).not.toContain('Modo demostración');
  });
});
