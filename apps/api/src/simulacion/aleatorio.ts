/**
 * Generador pseudoaleatorio con semilla (mulberry32). Hace reproducibles el seed,
 * el simulador y los tests. NO usar para nada criptográfico.
 */
export class Aleatorio {
  private estado: number;

  constructor(semilla: number = Date.now()) {
    this.estado = semilla >>> 0;
  }

  /** Número en [0, 1). */
  siguiente(): number {
    this.estado = (this.estado + 0x6d2b79f5) >>> 0;
    let t = this.estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero en [min, max], ambos incluidos. */
  entero(min: number, max: number): number {
    return min + Math.floor(this.siguiente() * (max - min + 1));
  }

  /** Decimal en [min, max) redondeado a 2 decimales. */
  monto(min: number, max: number): number {
    return Math.round((min + this.siguiente() * (max - min)) * 100) / 100;
  }

  probabilidad(p: number): boolean {
    return this.siguiente() < p;
  }

  elegir<T>(opciones: readonly T[]): T {
    if (opciones.length === 0) throw new Error('No hay opciones para elegir.');
    return opciones[Math.floor(this.siguiente() * opciones.length)] as T;
  }

  elegirPonderado<T>(opciones: readonly (readonly [T, number])[]): T {
    const total = opciones.reduce((suma, [, peso]) => suma + peso, 0);
    let r = this.siguiente() * total;
    for (const [valor, peso] of opciones) {
      r -= peso;
      if (r < 0) return valor;
    }
    return opciones[opciones.length - 1]![0];
  }

  digitos(cantidad: number): string {
    let texto = '';
    for (let i = 0; i < cantidad; i++) texto += this.entero(0, 9).toString();
    return texto;
  }
}
