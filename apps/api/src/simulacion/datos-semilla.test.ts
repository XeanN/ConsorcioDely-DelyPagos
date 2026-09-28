import { describe, expect, it } from 'vitest';
import { Aleatorio } from './aleatorio.js';
import { generarDatosSemilla } from './datos-semilla.js';
import { esRucValido } from './documentos.js';

const AHORA = new Date('2026-09-28T16:00:00Z');
const datos = generarDatosSemilla(new Aleatorio(20260928), AHORA);

describe('datos semilla', () => {
  it('genera 60 clientes: 20 mayoristas, 25 minoristas y 15 consumidores finales', () => {
    const porTipo = (t: string) => datos.clientes.filter((c) => c.tipo === t).length;
    expect(datos.clientes).toHaveLength(60);
    expect(porTipo('MAYORISTA')).toBe(20);
    expect(porTipo('MINORISTA')).toBe(25);
    expect(porTipo('CONSUMIDOR_FINAL')).toBe(15);
  });

  it('usa documentos válidos y únicos', () => {
    const docs = datos.clientes.map((c) => c.numeroDoc);
    expect(new Set(docs).size).toBe(docs.length);
    for (const c of datos.clientes) {
      if (c.tipoDoc === 'RUC') expect(esRucValido(c.numeroDoc)).toBe(true);
      else expect(c.numeroDoc).toMatch(/^\d{8}$/);
    }
    for (const c of datos.clientes.filter((x) => x.tipo === 'MAYORISTA')) {
      expect(c.numeroDoc.startsWith('20')).toBe(true);
    }
  });

  it('no usa correos reales', () => {
    for (const c of datos.clientes) if (c.correo) expect(c.correo).toMatch(/\.example\.com$/);
  });

  it('genera 150 comprobantes con numeración correlativa única por serie', () => {
    expect(datos.comprobantes).toHaveLength(150);
    const claves = datos.comprobantes.map((c) => `${c.serie}-${c.numero}`);
    expect(new Set(claves).size).toBe(150);
  });

  it('mantiene saldos coherentes con el estado', () => {
    for (const c of datos.comprobantes) {
      if (c.estado === 'PAGADO') expect(c.saldoPendiente).toBe(0);
      if (c.estado === 'PENDIENTE') expect(c.saldoPendiente).toBe(c.total);
      if (c.estado === 'PARCIAL') {
        expect(c.saldoPendiente).toBeGreaterThan(0);
        expect(c.saldoPendiente).toBeLessThan(c.total);
      }
      expect(c.fechaVencimiento.getTime()).toBeGreaterThan(c.fechaEmision.getTime());
    }
  });

  it('incluye deuda vencida en varios tramos de antigüedad', () => {
    const hoy = AHORA.getTime();
    const diasVencido = datos.comprobantes
      .filter((c) => c.estado !== 'PAGADO')
      .map((c) => Math.floor((hoy - c.fechaVencimiento.getTime()) / 86_400_000));
    expect(diasVencido.some((d) => d < 0)).toBe(true);
    expect(diasVencido.some((d) => d >= 1 && d <= 30)).toBe(true);
    expect(diasVencido.some((d) => d >= 31 && d <= 60)).toBe(true);
    expect(diasVencido.some((d) => d > 60)).toBe(true);
  });

  it('boletas solo para clientes con DNI y facturas para RUC', () => {
    const porDoc = new Map(datos.clientes.map((c) => [c.numeroDoc, c]));
    for (const c of datos.comprobantes) {
      const cliente = porDoc.get(c.numeroDocCliente)!;
      expect(c.tipo).toBe(cliente.tipoDoc === 'RUC' ? 'FACTURA' : 'BOLETA');
    }
  });

  it('crea pedidos abiertos de los últimos 30 minutos', () => {
    expect(datos.pedidos).toHaveLength(5);
    for (const p of datos.pedidos) {
      expect(AHORA.getTime() - p.creadoEn.getTime()).toBeLessThanOrEqual(30 * 60_000);
    }
  });
});
