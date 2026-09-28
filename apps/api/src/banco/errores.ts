export class ProveedorNoConfiguradoError extends Error {
  constructor(proveedor: string, detalle: string) {
    super(`Proveedor bancario "${proveedor}" no configurado: ${detalle}`);
    this.name = 'ProveedorNoConfiguradoError';
  }
}

export class CciInvalidoError extends Error {
  constructor() {
    super('El CCI debe tener exactamente 20 dígitos.');
    this.name = 'CciInvalidoError';
  }
}

export class CuentaNoEncontradaError extends Error {
  constructor(cuentaId: string) {
    super(`La cuenta ${cuentaId} no existe en el proveedor bancario.`);
    this.name = 'CuentaNoEncontradaError';
  }
}

/** El servicio del banco no respondió; la validación queda como NO_DISPONIBLE. */
export class ServicioBancarioNoDisponibleError extends Error {
  constructor(operacion: string) {
    super(`El servicio bancario no está disponible (${operacion}).`);
    this.name = 'ServicioBancarioNoDisponibleError';
  }
}
