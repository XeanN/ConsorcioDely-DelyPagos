import { parsearSse } from './sse';

describe('parsearSse', () => {
  it('separa eventos completos y conserva el resto incompleto', () => {
    const { eventos, resto } = parsearSse(
      'event: conectado\ndata: {"hora":"x"}\n\nevent: movimiento\ndata: {"id":"1"}\n\nevent: movi',
    );
    expect(eventos).toEqual([
      { evento: 'conectado', datos: '{"hora":"x"}' },
      { evento: 'movimiento', datos: '{"id":"1"}' },
    ]);
    expect(resto).toBe('event: movi');
  });

  it('une un evento que llegó partido en dos trozos', () => {
    const primero = parsearSse('event: movimiento\ndata: {"id"');
    expect(primero.eventos).toEqual([]);
    const segundo = parsearSse(`${primero.resto}:"2"}\n\n`);
    expect(segundo.eventos).toEqual([{ evento: 'movimiento', datos: '{"id":"2"}' }]);
  });

  it('ignora latidos y la instrucción retry', () => {
    const { eventos } = parsearSse(': latido\n\nretry: 3000\n\n');
    expect(eventos).toEqual([]);
  });

  it('acepta saltos de línea de Windows', () => {
    const { eventos } = parsearSse('event: movimiento\r\ndata: {}\r\n\r\n');
    expect(eventos).toEqual([{ evento: 'movimiento', datos: '{}' }]);
  });
});
