import { describe, expect, it } from 'vitest';
import { normalizarNombre } from './normalizar.js';

describe('normalizarNombre', () => {
  it('pasa a mayúsculas y quita tildes', () => {
    expect(normalizarNombre('José Cáceres Ñahui')).toBe('JOSE CACERES NAHUI');
  });

  it.each([
    ['DISTRIBUIDORA QUISPE S.A.C.', 'DISTRIBUIDORA QUISPE'],
    ['Distribuidora Quispe SAC', 'DISTRIBUIDORA QUISPE'],
    ['COMERCIAL ROJAS E.I.R.L.', 'COMERCIAL ROJAS'],
    ['COMERCIAL ROJAS EIRL', 'COMERCIAL ROJAS'],
    ['TRANSPORTES NORTE S.R.L.', 'TRANSPORTES NORTE'],
    ['IMPORTADORA ANDINA S.A.', 'IMPORTADORA ANDINA'],
    ['IMPORTADORA ANDINA SA', 'IMPORTADORA ANDINA'],
  ])('quita el sufijo societario de "%s"', (entrada, esperado) => {
    expect(normalizarNombre(entrada)).toBe(esperado);
  });

  it('no recorta palabras que terminan en SA dentro del nombre', () => {
    expect(normalizarNombre('ROSA HUAMAN')).toBe('ROSA HUAMAN');
    expect(normalizarNombre('INVERSIONES SANSA')).toBe('INVERSIONES SANSA');
  });

  it('elimina puntuación y espacios repetidos', () => {
    expect(normalizarNombre('  DISTRIB.  QUISPE & ROJAS  ')).toBe('DISTRIB QUISPE Y ROJAS');
  });
});
