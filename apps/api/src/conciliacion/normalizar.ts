const SUFIJOS_SOCIETARIOS =
  /\b(S\s*\.?\s*A\s*\.?\s*C|E\s*\.?\s*I\s*\.?\s*R\s*\.?\s*L|S\s*\.?\s*R\s*\.?\s*L|S\s*\.?\s*A\s*\.?\s*A|S\s*\.?\s*A)\s*\.?\s*$/;

/**
 * Normaliza un nombre de persona o empresa para compararlo:
 * mayúsculas, sin tildes, sin sufijos societarios (S.A.C., E.I.R.L., S.R.L., S.A.)
 * y sin signos de puntuación.
 */
export function normalizarNombre(texto: string): string {
  let limpio = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/&/g, ' Y ')
    .replace(/\s+/g, ' ')
    .trim();
  limpio = limpio.replace(SUFIJOS_SOCIETARIOS, '');
  return limpio
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
