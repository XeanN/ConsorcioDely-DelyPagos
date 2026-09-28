export interface EventoSse {
  evento: string;
  datos: string;
}

/**
 * Separa el texto recibido en eventos SSE completos. Devuelve también el resto
 * incompleto, que se completa con el siguiente trozo que llegue.
 */
export function parsearSse(texto: string): { eventos: EventoSse[]; resto: string } {
  const normalizado = texto.replace(/\r\n/g, '\n');
  const bloques = normalizado.split('\n\n');
  const resto = bloques.pop() ?? '';
  const eventos: EventoSse[] = [];
  for (const bloque of bloques) {
    let evento = 'message';
    const datos: string[] = [];
    for (const linea of bloque.split('\n')) {
      if (!linea || linea.startsWith(':')) continue; // comentario (latido)
      const separador = linea.indexOf(':');
      const campo = separador === -1 ? linea : linea.slice(0, separador);
      const valor = separador === -1 ? '' : linea.slice(separador + 1).replace(/^ /, '');
      if (campo === 'event') evento = valor;
      else if (campo === 'data') datos.push(valor);
    }
    if (datos.length > 0) eventos.push({ evento, datos: datos.join('\n') });
  }
  return { eventos, resto };
}
