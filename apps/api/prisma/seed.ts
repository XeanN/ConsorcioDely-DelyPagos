import { cargarConfig } from '../src/config.js';
import { crearBaseDatos } from '../src/db/prisma.js';
import { MockBankProvider } from '../src/banco/mock/mock-bank-provider.js';
import { ejecutarSeed } from '../src/seed/ejecutar-seed.js';

const config = cargarConfig();
if (config.BANK_PROVIDER !== 'mock') {
  console.error('El seed de demostración solo funciona con BANK_PROVIDER=mock.');
  process.exit(1);
}

const db = crearBaseDatos(config.DATABASE_URL);
// Semilla fija: el historial bancario es el mismo en cada ejecución.
const banco = new MockBankProvider({ semilla: 20260928, historialDias: 14 });

try {
  const resumen = await ejecutarSeed(db, banco, config);
  console.log('Datos de demostración cargados:');
  console.table({
    Usuarios: resumen.usuarios,
    'Cuentas bancarias': resumen.cuentas,
    Clientes: resumen.clientes,
    Comprobantes: resumen.comprobantes,
    'Pedidos en caja': resumen.pedidos,
    Proveedores: resumen.proveedores,
    'Movimientos (14 días)': resumen.movimientos,
  });
  console.log('Usuarios: admin@, tesoreria@, caja1@, caja2@, vendedor1..3@dely.demo');
  if (resumen.claveGenerada) {
    console.log(`Contraseña generada para todos (guárdela, no se vuelve a mostrar): ${resumen.claveGenerada}`);
    console.log('Para fijarla, defina SEED_CLAVE_DEMO en .env.');
  } else {
    console.log('Contraseña: la definida en SEED_CLAVE_DEMO.');
  }
} finally {
  banco.detener();
  await db.$disconnect();
}
