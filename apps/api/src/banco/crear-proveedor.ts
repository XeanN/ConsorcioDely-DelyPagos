import type { Config } from '../config.js';
import { ProveedorNoConfiguradoError } from './errores.js';
import { MockBankProvider } from './mock/mock-bank-provider.js';
import type { BankProvider } from './tipos.js';

/** Selecciona el adaptador bancario según `BANK_PROVIDER`. */
export function crearProveedorBancario(config: Config): BankProvider {
  switch (config.BANK_PROVIDER) {
    case 'mock':
      return new MockBankProvider({
        intervaloMinS: config.MOCK_INTERVALO_MIN_S,
        intervaloMaxS: config.MOCK_INTERVALO_MAX_S,
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
