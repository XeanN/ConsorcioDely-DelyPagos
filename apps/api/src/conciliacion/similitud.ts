import { normalizarNombre } from './normalizar.js';

function trigramas(texto: string): Set<string> {
  const relleno = `  ${texto} `;
  const conjunto = new Set<string>();
  for (let i = 0; i < relleno.length - 2; i++) conjunto.add(relleno.slice(i, i + 3));
  return conjunto;
}

/** Similitud de Jaccard entre trigramas (tolera errores de tipeo: "QUISPE" / "QISPE"). */
export function similitudTrigramas(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigramas(a);
  const tb = trigramas(b);
  let comunes = 0;
  for (const t of ta) if (tb.has(t)) comunes++;
  return comunes / (ta.size + tb.size - comunes);
}

/** Qué tanto se parecen dos palabras, considerando iniciales y abreviaturas bancarias. */
function similitudPalabra(a: string, b: string): number {
  if (a === b) return 1;
  // Inicial: "C" por "CARLOS".
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 0.8 : 0;
  // Abreviatura: "DISTRIB" por "DISTRIBUIDORA".
  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  if (corta.length >= 3 && larga.startsWith(corta)) return 0.9;
  const trigrama = similitudTrigramas(a, b);
  return trigrama >= 0.5 ? trigrama : 0;
}

export interface ResultadoSimilitud {
  valor: number;
  /** El primer nombre no coincide pero los apellidos sí: posible familiar. */
  posibleFamiliar: boolean;
}

/**
 * Similitud entre el nombre que envía el banco y el nombre registrado (0 a 1).
 * Evalúa palabra por palabra sobre el nombre más corto, porque los bancos truncan
 * y abrevian ("JUAN C QUISPE M" ↔ "JUAN CARLOS QUISPE MAMANI").
 */
export function similitudNombres(ordenante: string, registrado: string): ResultadoSimilitud {
  const a = normalizarNombre(ordenante).split(' ').filter(Boolean);
  const b = normalizarNombre(registrado).split(' ').filter(Boolean);
  if (a.length === 0 || b.length === 0) return { valor: 0, posibleFamiliar: false };
  if (a.join(' ') === b.join(' ')) return { valor: 1, posibleFamiliar: false };

  const [corta, larga] = a.length <= b.length ? [a, b] : [b, a];
  const usadas = new Set<number>();
  let suma = 0;
  let coincidencias = 0;
  for (const palabra of corta) {
    let mejor = 0;
    let indice = -1;
    larga.forEach((otra, i) => {
      if (usadas.has(i)) return;
      const s = similitudPalabra(palabra, otra);
      if (s > mejor) {
        mejor = s;
        indice = i;
      }
    });
    if (indice >= 0) usadas.add(indice);
    if (mejor > 0) coincidencias++;
    suma += mejor;
  }
  let valor = suma / corta.length;
  // Una sola palabra en común ("JUAN") no basta para identificar a alguien.
  if (corta.length === 1 || coincidencias < 2) valor *= 0.5;

  // Mismos apellidos pero un nombre de pila que no aparece en el otro: probablemente
  // un familiar, no el titular. (El orden no importa: "QUISPE MAMANI JUAN" es el titular.)
  const apareceEn = (palabra: string, lista: string[]) =>
    lista.some((otra) => similitudPalabra(palabra, otra) > 0);
  const primerNombreAusente = !apareceEn(a[0]!, b) || !apareceEn(b[0]!, a);
  const posibleFamiliar = primerNombreAusente && coincidencias >= 2;
  if (posibleFamiliar) valor = Math.min(valor, 0.6);

  return { valor: Math.round(valor * 1000) / 1000, posibleFamiliar };
}
