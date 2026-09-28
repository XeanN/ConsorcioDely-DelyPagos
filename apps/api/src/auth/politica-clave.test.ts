import { describe, expect, it } from 'vitest';
import { validarClaveNueva } from './politica-clave.js';

describe('validarClaveNueva', () => {
  it('acepta una contraseña que cumple todas las reglas', () => {
    expect(validarClaveNueva('Mostrador2026x', 'caja1')).toEqual([]);
  });

  it('exige longitud, minúscula, mayúscula y número', () => {
    expect(validarClaveNueva('Ab1', 'caja1')).toContain('Debe tener al menos 10 caracteres.');
    expect(validarClaveNueva('SOLOMAYUS123', 'caja1')).toContain('Debe incluir una letra minúscula.');
    expect(validarClaveNueva('solominus123', 'caja1')).toContain('Debe incluir una letra mayúscula.');
    expect(validarClaveNueva('SinNumerosAqui', 'caja1')).toContain('Debe incluir un número.');
  });

  it('rechaza contraseñas que contienen el usuario', () => {
    expect(validarClaveNueva('Finanzas1-2026', 'finanzas1')).toContain(
      'No debe contener el nombre de usuario.',
    );
  });

  it('rechaza contraseñas comunes aunque cumplan el formato', () => {
    expect(validarClaveNueva('Password2026', 'caja1')).toContain('Es una contraseña demasiado común.');
    expect(validarClaveNueva('DelyPagos123', 'caja1')).toContain('Es una contraseña demasiado común.');
  });
});
