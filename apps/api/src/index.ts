import { cargarConfig, configMotor } from './config.js';
import { ServicioConciliacion } from './conciliacion/servicio-conciliacion.js';
import { iniciarSentry } from './instrumentacion.js';
import { crearBaseDatos } from './db/prisma.js';
import { crearProveedorBancario } from './banco/crear-proveedor.js';
import { BusEventos } from './eventos/bus.js';
import { IngestaMovimientos } from './movimientos/ingesta.js';
import { crearFuentePagosEsperados } from './simulacion/pagos-esperados.js';

const config = cargarConfig();
iniciarSentry(config);

// Se importa después de iniciar Sentry para que pueda instrumentar Fastify.
const { construirApp } = await import('./app.js');
const db = crearBaseDatos(config.DATABASE_URL);
const bus = new BusEventos();
const app = await construirApp(config, { db, bus });

// El banco solo se usa a través de BankProvider (regla 2).
const banco = crearProveedorBancario(config, {
  obtenerPagosEsperados: config.BANK_PROVIDER === 'mock' ? crearFuentePagosEsperados(db) : undefined,
});
const ingesta = new IngestaMovimientos(db, banco, bus, app.log);

// Cada abono que llega se concilia automáticamente.
const conciliacion = new ServicioConciliacion(db, bus, configMotor(config), app.log);
bus.on('movimiento.registrado', (m) => {
  void conciliacion
    .conciliarMovimiento(m.id)
    .catch((error: unknown) => app.log.error({ err: error, movimientoId: m.id }, 'No se pudo conciliar'));
});

app.addHook('onClose', async () => {
  ingesta.detener();
  await db.$disconnect();
});

for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(senal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await ingesta.prepararCuentas();
  // Recupera lo que llegó mientras la API estuvo apagada (el banco real; el simulador no tiene).
  await ingesta.sincronizar(new Date(Date.now() - 24 * 60 * 60 * 1000));
  ingesta.iniciar();
  await app.listen({ port: config.API_PORT, host: '0.0.0.0' });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
