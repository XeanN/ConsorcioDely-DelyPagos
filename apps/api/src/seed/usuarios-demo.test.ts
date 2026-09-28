import { describe, expect, it } from 'vitest';
import { parsearUsuariosDemo } from './usuarios-demo.js';

describe('parsearUsuariosDemo', () => {
  it('deduce el rol y el nombre visible del prefijo', () => {
    expect(
      parsearUsuariosDemo('ventas1:ClavePrueba-V1, caja1:ClavePrueba-C1,finanzas1:ClavePrueba-F1'),
    ).toEqual([
      { usuario: 'ventas1', clave: 'ClavePrueba-V1', rol: 'VENTAS', nombre: 'Ventas 1' },
      { usuario: 'caja1', clave: 'ClavePrueba-C1', rol: 'CAJA', nombre: 'Caja 1' },
      { usuario: 'finanzas1', clave: 'ClavePrueba-F1', rol: 'FINANZAS', nombre: 'Finanzas 1' },
    ]);
  });

  it('permite ":" dentro de la clave', () => {
    expect(parsearUsuariosDemo('admin:Clave:Con:Dos')[0]).toMatchObject({
      usuario: 'admin',
      clave: 'Clave:Con:Dos',
      rol: 'ADMIN',
    });
  });

  it('exige la variable', () => {
    expect(() => parsearUsuariosDemo(undefined)).toThrow(/SEED_USUARIOS_DEMO/);
  });

  it('rechaza prefijos desconocidos, claves cortas y repetidos', () => {
    expect(() => parsearUsuariosDemo('gerente1:ClaveLarga1')).toThrow(/ventas, caja, finanzas/);
    expect(() => parsearUsuariosDemo('caja1:corta')).toThrow(/al menos 8/);
    expect(() => parsearUsuariosDemo('caja1:ClavePrueba-C1,CAJA1:ClavePrueba-C1')).toThrow(/repetido/);
  });

  it('no muestra la clave en los mensajes de error', () => {
    expect(() => parsearUsuariosDemo('gerente1:SecretoMuyPrivado')).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining('SecretoMuyPrivado') }),
    );
  });
});
