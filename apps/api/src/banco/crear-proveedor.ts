import type { Config } from '../config.js';
import { ProveedorNoConfiguradoError } from './errores.js';
import type { PagoEsperado } from './mock/generador.js';
import { MockBankProvider } from './mock/mock-bank-provider.js';
import type { BankProvider } from './tipos.js';

export interface OpcionesProveedor {
  /** Solo para el simulador: pagos que la tienda espera recibir. */
  obtenerPagosEsperados?: () => Promise<PagoEsperado[]>;
}

/** Selecciona el adaptador bancario según `BANK_PROVIDER`. */
export function crearProveedorBancario(config: Config, opciones: OpcionesProveedor = {}): BankProvider {
  switch (config.BANK_PROVIDER) {
    case 'mock':
      return new MockBankProvider({
        intervaloMinS: config.MOCK_INTERVALO_MIN_S,
        intervaloMaxS: config.MOCK_INTERVALO_MAX_S,
        // El historial ya lo cargó el seed; en ejecución solo llegan abonos nuevos.
        historialDias: 0,
        obtenerPagosEsperados: opciones.obtenerPagosEsperados,
        probabilidadPagoEsperado: 0.5,
      });
    case 'bcp-rest':
    case 'bcp-h2h':
      // Los stubs se implementan en F8; hasta el convenio con el BCP no hay credenciales.
      throw new ProveedorNoConfiguradoError(
        config.BANK_PROVIDER,
        'pendiente del convenio de APIs con el BCP',
      );
  }
}
