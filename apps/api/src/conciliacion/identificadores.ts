export interface Identificadores {
  /** Comprobantes mencionados, normalizados como "F001-2345". */
  comprobantes: Set<string>;
  /** DNI (8) o RUC (11) mencionados en la referencia o enviados por el banco. */
  documentos: Set<string>;
}

/** "F001" + "00002345" → "F001-2345". */
export function claveComprobante(serie: string, numero: number | string): string {
  return `${serie.toUpperCase()}-${Number(numero)}`;
}

// F001-2345, F001-00002345, F001 2345, F0012345, B001/123, F001 N° 45
const SERIE_NUMERO = /\b([FB]\d{3})[\s\-_/]*(?:N[°º.]?\s*)?(\d{1,8})\b/gi;
// FACT 001-2345, FACTURA 001 2345, BOL 001-99
const PALABRA_NUMERO = /\b(FACT(?:URA)?|BOL(?:ETA)?)\.?\s*(\d{3})[\s\-_/]+(\d{1,8})\b/gi;
const DOCUMENTO = /(?<!\d)(\d{11}|\d{8})(?!\d)/g;

/** Extrae de la glosa los comprobantes y documentos que el cliente escribió al pagar. */
export function extraerIdentificadores(
  referencia: string | null,
  documentoOrdenante: string | null,
): Identificadores {
  const comprobantes = new Set<string>();
  const documentos = new Set<string>();
  let texto = (referencia ?? '').toUpperCase();

  for (const m of texto.matchAll(PALABRA_NUMERO)) {
    const letra = m[1]!.startsWith('F') ? 'F' : 'B';
    comprobantes.add(claveComprobante(`${letra}${m[2]}`, m[3]!));
  }
  texto = texto.replace(PALABRA_NUMERO, ' ');
  for (const m of texto.matchAll(SERIE_NUMERO)) comprobantes.add(claveComprobante(m[1]!, m[2]!));
  // Se quitan los comprobantes antes de buscar documentos: "F001-00002345" no es un DNI.
  texto = texto.replace(SERIE_NUMERO, ' ');
  for (const m of texto.matchAll(DOCUMENTO)) documentos.add(m[1]!);

  if (documentoOrdenante && /^\d{8}$|^\d{11}$/.test(documentoOrdenante)) {
    documentos.add(documentoOrdenante);
  }
  return { comprobantes, documentos };
}

/** ¿El documento corresponde al cliente? Un RUC 10 contiene el DNI de la persona. */
export function documentoDelCliente(documentos: Set<string>, numeroDocCliente: string): boolean {
  if (documentos.has(numeroDocCliente)) return true;
  if (/^10\d{9}$/.test(numeroDocCliente)) return documentos.has(numeroDocCliente.slice(2, 10));
  return false;
}
