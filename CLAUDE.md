# Dely Pagos — Prototipo de verificación y conciliación de pagos

## Contexto del negocio
- Cliente: Consorcio Dely S.A.C. Vende solo en tiendas físicas, con más de 100 clientes diarios.
- Tipos de cliente: distribuidores mayoristas de provincias (compran en volumen, a veces a crédito con factura), minoristas y consumidor final.
- Problema actual: una sola persona verifica manualmente cada pago por transferencia, Yape o Plin, revisando la banca por internet. Esto genera colas en caja y riesgo de vouchers falsos.
- Dely tiene cuentas corporativas en BCP y otros bancos. Su ERP es antiguo (reportes Crystal Reports) y NO se reemplaza. Este sistema solo lo complementa.
- Este proyecto es un **prototipo para demostración**. Los datos bancarios son SIMULADOS hasta que Dely firme el convenio de APIs con el BCP.

## Reglas no negociables
1. Nunca inventar endpoints "oficiales" del BCP. El contrato en `docs/contrato-api-bancaria.yaml` es PROVISIONAL y propio.
2. Toda la app accede al banco SOLO a través de la interfaz `BankProvider`. Ningún componente llama a HTTP bancario directamente.
3. En la interfaz debe mostrarse siempre un banner visible: "Modo demostración — datos simulados" cuando `BANK_PROVIDER=mock`.
4. Nunca subir credenciales al repositorio. Todo va en `.env` (incluir `.env.example`).
5. No usar n8n. Todo en TypeScript.
6. Toda confirmación manual de un pago queda registrada en un log de auditoría (usuario, fecha, movimiento, comprobante).
7. Código, nombres de dominio y UI en español. Montos en PEN (formato S/ 1,234.50) con soporte USD.
8. Git: NUNCA añadir en commits, PRs, README ni comentarios de código líneas como "Co-Authored-By: Claude", "Generated with Claude Code", "Claude-Session:" ni ninguna mención a IA o asistentes. Los mensajes de commit son breves, en español y en estilo convencional (feat:, fix:, refactor:, test:, docs:).

## Stack
- Monorepo con npm workspaces: `apps/api` y `apps/web`.
- API: Node 20 + TypeScript + Fastify + Prisma. Base de datos SQLite para la demo, preparada para migrar a PostgreSQL cambiando solo `DATABASE_URL` y el provider de Prisma.
- Tiempo real: Server-Sent Events (SSE) desde la API hacia la web.
- Web: React + Vite + TypeScript + Tailwind. Diseño sobrio y legible en monitor de caja.
- Tests: Vitest. El motor de conciliación debe tener cobertura alta.

## Arquitectura bancaria (adaptador)
```ts
interface BankProvider {
  nombre: string;
  listarCuentas(): Promise<Cuenta[]>;
  obtenerSaldo(cuentaId: string): Promise<Saldo>;
  listarMovimientos(cuentaId: string, desde: Date, hasta: Date): Promise<Movimiento[]>;
  validarCuenta(cci: string): Promise<ValidacionCuenta>; // titular de una cuenta destino
  suscribirMovimientos(cb: (m: Movimiento) => void): () => void; // push (webhook) o polling interno
}
```
Implementaciones:
- `MockBankProvider`: genera movimientos realistas con un simulador configurable (cada 10–40 s). Canales posibles: TRANSFERENCIA, INTERBANCARIA, YAPE, PLIN, DEPOSITO_AGENCIA. Usa nombres peruanos, algunos abreviados o distintos al titular registrado.
- `BcpRestProvider`: stub con OAuth2 client credentials y TODOs. Lanza `ProveedorNoConfiguradoError` si faltan credenciales.
- `BcpH2HProvider`: stub para el escenario de intercambio de archivos (Telecrédito Host-to-Host). Lee archivos de movimientos desde una carpeta o SFTP y los normaliza a `Movimiento`.
- Se selecciona con la variable `BANK_PROVIDER=mock|bcp-rest|bcp-h2h`. Queda preparado para agregar otros bancos (BBVA, Interbank, etc.) con el mismo contrato.

## Modelo de dominio (Prisma)
- `Cliente`: tipoDoc (DNI|RUC), numeroDoc, nombre/razonSocial, tipo (MAYORISTA|MINORISTA|CONSUMIDOR_FINAL), alias (nombres alternativos observados en pagos).
- `Comprobante`: serie-número, clienteId, fecha de emisión, fecha de vencimiento, total, saldo pendiente, moneda, estado (PENDIENTE|PARCIAL|PAGADO).
- `PedidoCaja`: pedido en mostrador esperando pago (tienda, caja, monto, cliente opcional, creado en). Es el caso más frecuente en tienda.
- `Movimiento`: id del banco, cuenta, fecha y hora, monto, moneda, canal, nombre del ordenante, documento del ordenante (si viene), referencia/glosa, número de operación.
- `Conciliacion`: movimientoId, destino (comprobante o pedido), puntaje, estado (CONCILIADO|PROBABLE|SIN_IDENTIFICAR|DESCARTADO), motivos (json), confirmadoPor, confirmadoEn.
- `Proveedor`: RUC, razón social, CCI registrado, titular esperado.
- `Alerta` y `Auditoria`.

## Los 5 módulos

### 1. Monitor de movimientos en tiempo real
- Vista principal para caja o tesorería: lista en vivo por SSE con hora, monto, canal, ordenante y estado de conciliación con colores.
- Filtros por cuenta, canal, estado y rango. Totales del día por canal.
- Búsqueda rápida por monto (caso de uso: el cajero digita "350" y ve si llegó).

### 2. Motor de conciliación automática
- Cruza cada movimiento contra `PedidoCaja` abiertos (prioridad, ventana de 30 min) y `Comprobante` pendientes.
- Señales y pesos iniciales (configurables):
  - Monto exacto: 0.40. Si hay tolerancia de redondeo, puntaje proporcional.
  - Nombre del ordenante vs cliente o alias: 0.35. Normalizar mayúsculas, quitar tildes y sufijos (S.A.C., E.I.R.L., S.A.) y usar similitud de tokens y trigramas.
  - Referencia contiene serie-número, RUC o DNI: 0.25. Si esto coincide, sube a CONCILIADO aunque el nombre difiera.
- Umbrales: ≥ 0.85 → CONCILIADO; 0.60–0.85 → PROBABLE (requiere un clic de confirmación); < 0.60 → SIN_IDENTIFICAR.
- Regla de seguridad: si dos o más candidatos comparten el mismo monto y puntaje similar, nunca conciliar automáticamente. Marcar PROBABLE y mostrar los candidatos.
- Pagos parciales de mayoristas: aplicar al comprobante más antiguo del cliente y actualizar el saldo.
- Al confirmar manualmente un PROBABLE, guardar el nombre del ordenante como alias del cliente para aprender.
- Explicabilidad: cada conciliación muestra por qué ("monto exacto + referencia F001-2345").

### 3. Alertas de pago recibido
- Notificación en pantalla con sonido en la caja cuando se concilia un pago de un pedido abierto.
- Panel de alertas para tesorería: pagos SIN_IDENTIFICAR con más de 15 minutos de antigüedad, montos inusualmente altos y pagos duplicados.
- Interfaz `CanalNotificacion` con implementación en pantalla ahora. WhatsApp Cloud API y correo quedan como stubs para una fase posterior.

### 4. Validación de cuenta de proveedores
- Antes de registrar o pagar a un proveedor, consultar `validarCuenta(cci)` y comparar el titular devuelto con la razón social registrada.
- Resultados: COINCIDE, NO_COINCIDE (bloquear y alertar) o NO_DISPONIBLE.
- Validar formato del CCI (20 dígitos) antes de consultar.
- El mock debe incluir al menos un caso de CCI cuyo titular no coincide (simula intento de fraude).

### 5. Posición de caja
- Saldo actual por cuenta y moneda.
- Ingresos del día conciliados vs no identificados.
- Cuentas por cobrar por tramos de antigüedad: por vencer, 1–30, 31–60 y más de 60 días. Top 10 mayoristas con mayor deuda.
- Gráfico simple de ingresos de los últimos 14 días.

## Modo presentación
- Botón (solo en modo mock) que inyecta escenarios guionados, en este orden:
  1. Pago Yape exacto de un pedido en caja → CONCILIADO + alerta sonora.
  2. Transferencia de un mayorista con referencia de factura pero nombre abreviado → CONCILIADO por referencia.
  3. Pago con nombre de un familiar del cliente → PROBABLE, se confirma y se aprende el alias.
  4. Dos pedidos del mismo monto → PROBABLE con candidatos, sin conciliación automática.
  5. Pago parcial de mayorista → comprobante en estado PARCIAL.
  6. Validación de proveedor con titular que no coincide → bloqueo.
- Datos semilla: unos 60 clientes (20 mayoristas), 150 comprobantes y 3 cuentas (BCP PEN, BCP USD, otro banco PEN).

## Fases de construcción (ejecutar una por una y validar antes de seguir)
- F0: Scaffold del monorepo, lint, `.env.example`, scripts `dev`, `test` y `seed`.
- F1: Esquema Prisma, `BankProvider`, `MockBankProvider` con simulador y seed.
- F2: Endpoint SSE y módulo 1 (monitor).
- F3: Motor de conciliación con tests unitarios (casos del modo presentación como tests) y módulo 2.
- F4: Módulo 3 (alertas).
- F5: Módulo 4 (validación de proveedores).
- F6: Módulo 5 (posición de caja).
- F7: Modo presentación, stubs `BcpRestProvider` y `BcpH2HProvider`, y README con instrucciones de demo.

## Pendientes que dependen del BCP (no bloquean la demo)
- Documentación oficial, credenciales y sandbox (las gestiona Dely con su ejecutivo de banca empresas).
- Confirmar si el acceso será por API REST, por Host-to-Host o por ambos.
- Confirmar si hay notificación push (webhook) o solo consulta periódica, y con qué latencia.
- Confirmar qué campos llegan en movimientos de Yape y Plin (nombre y documento del ordenante).