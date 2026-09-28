import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Ingresar } from './ingresar';
import { Sesion } from '../../core/auth/sesion';

describe('Ingresar', () => {
  const sesion = { iniciarSesion: vi.fn<(u: string, c: string) => Promise<string | null>>() };

  beforeEach(async () => {
    sesion.iniciarSesion.mockReset();
    await TestBed.configureTestingModule({
      imports: [Ingresar],
      providers: [provideRouter([]), { provide: Sesion, useValue: sesion }],
    }).compileComponents();
  });

  async function montar() {
    const fixture = TestBed.createComponent(Ingresar);
    await fixture.whenStable();
    const html = fixture.nativeElement as HTMLElement;
    const escribir = async (id: string, valor: string) => {
      const input = html.querySelector<HTMLInputElement>(`#${id}`)!;
      input.value = valor;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    const enviar = async () => {
      html.querySelector('form')!.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
    };
    return { fixture, html, escribir, enviar };
  }

  it('oculta la contraseña y permite mostrarla con el botón', async () => {
    const { html, fixture } = await montar();
    const clave = html.querySelector<HTMLInputElement>('#clave')!;
    const boton = html.querySelector<HTMLButtonElement>('button[aria-label="Mostrar contraseña"]')!;
    expect(clave.type).toBe('password');

    boton.click();
    await fixture.whenStable();
    expect(clave.type).toBe('text');
    expect(boton.getAttribute('aria-label')).toBe('Ocultar contraseña');

    boton.click();
    await fixture.whenStable();
    expect(clave.type).toBe('password');
  });

  it('el texto de los campos es negro para leerlo sin error', async () => {
    const { html } = await montar();
    expect(html.querySelector('#usuario')!.className).toContain('text-black');
    expect(html.querySelector('#clave')!.className).toContain('text-black');
  });

  it('no envía el formulario vacío', async () => {
    const { html, enviar } = await montar();
    await enviar();
    expect(sesion.iniciarSesion).not.toHaveBeenCalled();
    expect(html.textContent).toContain('Ingrese su usuario.');
  });

  it('ingresa y navega al inicio', async () => {
    sesion.iniciarSesion.mockResolvedValue(null);
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { escribir, enviar } = await montar();
    await escribir('usuario', 'caja1');
    await escribir('clave', 'ClavePrueba-C1');
    await enviar();
    expect(sesion.iniciarSesion).toHaveBeenCalledWith('caja1', 'ClavePrueba-C1');
    expect(navegar).toHaveBeenCalledWith(['/']);
  });

  it('muestra el error y borra la contraseña si falla', async () => {
    sesion.iniciarSesion.mockResolvedValue('Usuario o contraseña incorrectos');
    const { html, escribir, enviar } = await montar();
    await escribir('usuario', 'caja1');
    await escribir('clave', 'mala');
    await enviar();
    expect(html.querySelector('[role="alert"]')!.textContent).toContain('Usuario o contraseña incorrectos');
    expect(html.querySelector<HTMLInputElement>('#clave')!.value).toBe('');
  });
});
