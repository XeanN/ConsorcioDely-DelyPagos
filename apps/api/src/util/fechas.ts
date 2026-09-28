/** Lima está en UTC-5 todo el año (sin horario de verano). */
const DESFASE_LIMA_MS = 5 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Fecha de hoy en Lima, en formato AAAA-MM-DD. */
export function hoyLima(ahora: Date = new Date()): string {
  return new Date(ahora.getTime() - DESFASE_LIMA_MS).toISOString().slice(0, 10);
}

/** Inicio (incluido) y fin (excluido) de un día calendario de Lima, en UTC. */
export function rangoDiaLima(fecha: string): { desde: Date; hasta: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`Fecha inválida: ${fecha}`);
  const medianoche = Date.parse(`${fecha}T00:00:00.000Z`);
  if (Number.isNaN(medianoche)) throw new Error(`Fecha inválida: ${fecha}`);
  const desde = new Date(medianoche + DESFASE_LIMA_MS);
  return { desde, hasta: new Date(desde.getTime() + DIA_MS) };
}
