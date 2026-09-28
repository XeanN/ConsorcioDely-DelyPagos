import { describe, expect, it } from 'vitest';
import { Aleatorio } from './aleatorio.js';
import { generarPersona, variarNombrePersona, variarRazonSocial } from './datos-peru.js';
import { digitoVerificadorRuc, esRucValido, generarDni, generarRuc } from './documentos.js';
import { esFormatoCciValido, limpiarCci } from '../banco/cci.js';

describe('Aleatorio', () => {
  it('es determinista con la misma semilla', () => {
    const a = new Aleatorio(7);
    const b = new Aleatorio(7);
    expect([a.siguiente(), a.siguiente()]).toEqual([b.siguiente(), b.siguiente()]);
  });

  it('respeta los límites de entero y monto', () => {
    const a = new Aleatorio(1);
    for (let i = 0; i < 500; i++) {
      const n = a.entero(3, 5);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
      const m = a.monto(10, 20);
      expect(Number(m.toFixed(2))).toBe(m);
      expect(m).toBeGreaterThanOrEqual(10);
      expect(m).toBeLessThanOrEqual(20);
    }
  });
});

describe('RUC y DNI', () => {
  it('calcula el dígito verificador de SUNAT', () => {
    // 20100070970: RUC público conocido (Supermercados Peruanos S.A.).
    expect(digitoVerificadorRuc('2010007097')).toBe(0);
    expect(esRucValido('20100070970')).toBe(true);
    expect(esRucValido('20100070971')).toBe(false);
    expect(esRucValido('3010007097')).toBe(false);
  });

  it('genera RUC y DNI válidos', () => {
    const a = new Aleatorio(3);
    for (let i = 0; i < 100; i++) {
      expect(esRucValido(generarRuc(a, '20'))).toBe(true);
      expect(generarDni(a)).toMatch(/^\d{8}$/);
    }
  });

  it('el RUC 10 contiene el DNI de la persona', () => {
    expect(generarRuc(new Aleatorio(1), '10', '45678912')).toMatch(/^1045678912\d$/);
  });
});

describe('CCI', () => {
  it('valida 20 dígitos y tolera guiones y espacios', () => {
    expect(esFormatoCciValido('00219100204587103854')).toBe(true);
    expect(esFormatoCciValido('002-191-002045871038-54')).toBe(true);
    expect(esFormatoCciValido('0021910020458710385')).toBe(false);
    expect(esFormatoCciValido('0021910020458710385A')).toBe(false);
    expect(limpiarCci(' 002 191 ')).toBe('002191');
  });
});

describe('variantes de nombres', () => {
  it('las variantes de una persona conservan su apellido paterno', () => {
    const a = new Aleatorio(9);
    for (let i = 0; i < 50; i++) {
      const persona = generarPersona(a);
      const variante = variarNombrePersona(a, persona);
      expect(variante.slice(0, 20)).toBeTruthy();
      expect(`${variante} `).toMatch(new RegExp(persona.apellidoPaterno.slice(0, 3)));
    }
  });

  it('abrevia razones sociales como lo hacen los bancos', () => {
    const a = new Aleatorio(2);
    const variantes = new Set(
      Array.from({ length: 40 }, () => variarRazonSocial(a, 'DISTRIBUIDORA QUISPE PUNO S.A.C.')),
    );
    expect(variantes).toContain('DISTRIB. QUISPE PUNO');
    expect(variantes).toContain('DISTRIBUIDORA QUISPE PUNO');
  });
});
