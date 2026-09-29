import { TestBed } from '@angular/core/testing';
import { BandejaConciliacion } from './bandeja';
import { ConciliacionApi, type ItemBandeja } from './conciliacion-api';

const item: ItemBandeja = {
  id: 'c1',
  estado: 'PROBABLE',
  puntaje: 0.8,
  motivos: ['monto exacto', 'mismo apellido, otro nombre (¿familiar?)'],
  candidatos: [
    {
      tipo: 'COMPROBANTE',
      id: 'b1',
      clienteId: 'cli',
      descripcion: 'B001-00005500 · JUAN CARLOS QUISPE MAMANI',
      puntaje: 0.8,
      montoAplicado: 780,
      esParcial: false,
      motivos: ['monto exacto'],
    },
  ],
  destino: { tipo: 'COMPROBANTE', id: 'b1' },
  montoAplicado: null,
  confirmadoPor: null,
  confirmadoEn: null,
  movimiento: {
    id: 'm1',
    idBanco: 'x',
    cuentaId: 'bcp-pen-01',
    banco: 'BCP',
    fechaHora: '2026-09-29T15:00:00.000Z',
    monto: 780,
    moneda: 'PEN',
    canal: 'TRANSFERENCIA',
    numeroOperacion: '1',
    ordenanteNombre: 'MARIA QUISPE MAMANI',
    ordenanteTipoDoc: null,
    ordenanteNumeroDoc: null,
    ordenanteBanco: null,
    ordenanteCuenta: null,
    referencia: null,
    estado: 'PROBABLE',
  },
};

describe('BandejaConciliacion', () => {
  const api = {
    bandeja: vi.fn(async () => [item]),
    confirmar: vi.fn(async () => undefined),
  };

  beforeEach(async () => {
    api.bandeja.mockClear();
    api.confirmar.mockClear();
    await TestBed.configureTestingModule({
      imports: [BandejaConciliacion],
      providers: [{ provide: ConciliacionApi, useValue: api }],
    }).compileComponents();
  });

  it('muestra el pago, los motivos y los candidatos', async () => {
    const fixture = TestBed.createComponent(BandejaConciliacion);
    await fixture.whenStable();
    const texto = (fixture.nativeElement as HTMLElement).textContent!;
    expect(texto).toContain('S/ 780.00');
    expect(texto).toContain('MARIA QUISPE MAMANI');
    expect(texto).toContain('mismo apellido, otro nombre (¿familiar?)');
    expect(texto).toContain('B001-00005500 · JUAN CARLOS QUISPE MAMANI');
  });

  it('confirma el candidato elegido', async () => {
    const fixture = TestBed.createComponent(BandejaConciliacion);
    await fixture.whenStable();
    const boton = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === 'Confirmar',
    )!;
    boton.click();
    await fixture.whenStable();
    expect(api.confirmar).toHaveBeenCalledWith('c1', 'COMPROBANTE', 'b1');
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('aplicado a B001-00005500');
  });
});
