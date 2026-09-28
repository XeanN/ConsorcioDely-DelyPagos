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
9. Seguridad desde el inicio: ningún endpoint de negocio sin autenticación y rol. Toda entrada se valida con esquema en la API. Nunca SQL construido con strings (`$queryRawUnsafe` prohibido). Ver sección "Seguridad".

## Stack
- Monorepo con npm workspaces: `apps/api` y `apps/web`.
- API: Node 24 LTS + TypeScript + Fastify + Prisma 7 (adaptador `@prisma/adapter-pg`).
- Base de datos: PostgreSQL 17 gestionado en la nube (Neon, región São Paulo) desde la demo. Sin Docker ni SQLite. Conexión solo con TLS (`sslmode=require`). `DATABASE_URL` (pooled, para la app) y `DIRECT_URL` (directa, para migraciones). El navegador nunca se conecta a la base: solo la API.
- Contrato de integración: REST versionado bajo `/api/v1`, documentado con OpenAPI (Swagger UI en `/api/docs`, deshabilitado en producción salvo configuración). Cualquier sistema externo (ERP, otros lenguajes, otros dominios) se integra por este contrato.
- Tiempo real: Server-Sent Events (SSE) desde la API hacia la web.
- Web: Angular 22 (componentes standalone + signals, sin NgModules) + TypeScript estricto + Tailwind. Diseño sobrio y legible en monitor de caja.
- Observabilidad: Sentry opcional en API y web (se activa solo si hay `SENTRY_DSN`), sin datos personales.
- Tests: Vitest. El motor de conciliación debe tener cobertura alta.

## Seguridad (amenaza → control)
- **Inyección SQL** → solo Prisma con consultas parametrizadas; validación de toda entrada con Zod (tipos, longitudes, formatos: RUC 11, DNI 8, CCI 20 dígitos).
- **XSS / clickjacking** → sanitización por defecto de Angular (prohibido `bypassSecurityTrust*`), cabeceras con `@fastify/helmet` (CSP estricta, `X-Frame-Options`, `nosniff`, `Referrer-Policy`).
- **Captura de tráfico (Wireshark, MITM)** → HTTPS obligatorio en todo entorno fuera de localhost, HSTS, cookies `Secure`; conexión a PostgreSQL con TLS; los datos nunca viajan en claro.
- **Escaneo de puertos (nmap)** → en producción solo se expone 443 a través de Cloudflare (Tunnel o proxy); la base de datos y los puertos internos nunca son públicos.
- **Fuerza bruta / DoS** → `@fastify/rate-limit` global y más estricto en login; bloqueo temporal de cuenta tras intentos fallidos; Cloudflare WAF y protección DDoS delante.
- **Robo de sesión / CSRF** → JWT de acceso de vida corta (15 min) en memoria del navegador; refresh token en cookie `HttpOnly; Secure; SameSite=Strict` con rotación. Contraseñas con argon2.
- **Acceso indebido** → roles verificados en cada endpoint (ver "Roles y permisos"); guards de ruta en Angular solo como apoyo visual.
- **Otros dominios y puertos** → CORS con lista blanca (`CORS_ORIGENES`), nunca `*`. Sistemas externos usan OAuth2 client credentials con rol `INTEGRACION`.
- **Suplantación en integraciones** → webhooks salientes firmados con HMAC-SHA256 (`X-Dely-Firma` + timestamp contra replay).
- **Fuga de información** → errores genéricos al cliente (sin stack traces); Sentry con `dataCollection` restrictivo (sin usuario, cabeceras, cuerpos, parámetros SQL ni variables locales) y depuración de documentos, nombres, cuentas y montos antes de enviar; logs sin secretos.
- **Manipulación de registros** → la auditoría es solo de inserción (un trigger de PostgreSQL rechaza UPDATE y DELETE) y cada registro encadena el hash del anterior (detecta alteraciones).
- **Scripts de instalación maliciosos** → npm 11 bloquea scripts de instalación; solo se aprueban paquetes concretos y versiones exactas en `allowScripts`.
- **Dependencias vulnerables** → `npm audit` en CI y actualizaciones periódicas.
- **Datos personales** → cumplimiento de la Ley 29733 (Perú): notificaciones a clientes solo con consentimiento registrado.

## Roles y permisos
- Roles de negocio: `VENTAS`, `CAJA`, `FINANZAS`. Roles de sistema: `ADMIN` (acceso total) e `INTEGRACION` (otros sistemas por OAuth2 client credentials). Ningún usuario de demo es ADMIN.
- Login por nombre de usuario (p. ej. `caja1`), no por correo. El rol se muestra en la interfaz como Ventas, Caja o Finanzas.
- Módulos por rol (la API aplica los mismos permisos que el menú):
  | Módulo | VENTAS | CAJA | FINANZAS |
  |---|---|---|---|
  | Monitor de movimientos | ✓ | ✓ | ✓ |
  | Conciliación (confirmar PROBABLE) | | ✓ | ✓ |
  | Alertas | ✓ (de sus clientes) | ✓ | ✓ |
  | Validación de proveedores | | | ✓ |
  | Posición de caja | | | ✓ |
  | Verificación de auditoría | | | ✓ |
- Usuarios de demo en `SEED_USUARIOS_DEMO` del `.env` (`usuario:clave,...`, rol por prefijo). Nunca en el código.
- Sesión: token de acceso de 15 min solo en memoria; refresh token opaco en cookie `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`, rotado en cada uso. Reusar un token rotado revoca todas las sesiones del usuario (margen de 30 s para pestañas simultáneas). En la base solo se guarda el SHA-256 del token.
- Bloqueo por usuario tras `LOGIN_MAX_INTENTOS` fallos y límite de intentos por IP. Mismo mensaje para usuario inexistente y clave incorrecta.

## Tests
- Unitarios: sin base de datos.
- Integración (`*.int.test.ts`): contra `TEST_DATABASE_URL`, una base exclusiva de pruebas (`dely_pruebas` en Neon) que se vacía en cada ejecución. Si no está configurada, se omiten. Nunca apuntar a la base de la demo (el helper lo impide).

## Ver la web desde internet (demo)
- Cloudflare Quick Tunnel: `cloudflared tunnel --url http://localhost:4200` genera una URL `https://*.trycloudflare.com` temporal. El dev server de Angular acepta solo ese dominio (`allowedHosts`). La URL cambia en cada ejecución y es pública: solo el login la protege. Cerrar el túnel al terminar.
- Producción (F8): túnel con nombre en la cuenta Cloudflare de Dely + Cloudflare Access/WAF.

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
- `Cliente`: tipoDoc (DNI|RUC), numeroDoc, nombre/razonSocial, tipo (MAYORISTA|MINORISTA|CONSUMIDOR_FINAL), alias (nombres alternativos observados en pagos), teléfono, correo, vendedor asignado, consentimiento de notificaciones.
- `CuentaOrigenCliente`: clienteId, banco, número o CCI de la cuenta desde la que pagó, veces vista, última vez. Se aprende al conciliar.
- `Usuario`: nombre, correo, hash de contraseña, rol, teléfono (para avisos a vendedores), activo, intentos fallidos, bloqueado hasta.
- `Comprobante`: serie-número, clienteId, fecha de emisión, fecha de vencimiento, total, saldo pendiente, moneda, estado (PENDIENTE|PARCIAL|PAGADO).
- `PedidoCaja`: pedido en mostrador esperando pago (tienda, caja, monto, cliente opcional, creado en). Es el caso más frecuente en tienda.
- `Movimiento`: id del banco, cuenta, fecha y hora, monto, moneda, canal, nombre del ordenante, documento del ordenante (si viene), cuenta de origen (si viene), referencia/glosa, número de operación.
- `Conciliacion`: movimientoId, destino (comprobante o pedido), puntaje, estado (CONCILIADO|PROBABLE|SIN_IDENTIFICAR|DESCARTADO), motivos (json), confirmadoPor, confirmadoEn.
- `Proveedor`: RUC, razón social, CCI registrado, titular esperado.
- `Alerta` y `Auditoria` (solo inserción, con hash encadenado).
- `Notificacion`: bandeja de salida (canal, destinatario, plantilla, estado PENDIENTE|ENVIADA|FALLIDA, intentos, error, enviadaEn).
- `SuscripcionWebhook`: URL destino, eventos, secreto HMAC, activa.

## Los 5 módulos

### 1. Monitor de movimientos en tiempo real
- Vista principal para caja o tesorería: lista en vivo por SSE con hora, monto, canal, ordenante y estado de conciliación con colores.
- Filtros por cuenta, canal, estado y rango. Totales del día por canal.
- Búsqueda rápida por monto (caso de uso: el cajero digita "350" y ve si llegó).

### 2. Motor de conciliación automática
- Cruza cada movimiento contra `PedidoCaja` abiertos (prioridad, ventana de 30 min) y `Comprobante` pendientes.
- Señales y pesos iniciales (configurables; se ajustan con los tests de F3):
  - Monto exacto: 0.35. Si hay tolerancia de redondeo, puntaje proporcional.
  - Nombre del ordenante vs cliente o alias: 0.25. Normalizar mayúsculas, quitar tildes y sufijos (S.A.C., E.I.R.L., S.A.) y usar similitud de tokens y trigramas.
  - Referencia contiene serie-número, RUC o DNI: 0.20. Si esto coincide, sube a CONCILIADO aunque el nombre difiera.
  - Cuenta de origen ya vista para ese cliente (`CuentaOrigenCliente`): 0.20.
  - Si el movimiento no trae un dato (p. ej. Yape sin cuenta de origen), esa señal no penaliza: los pesos se renormalizan entre las señales disponibles.
- Umbrales: ≥ 0.85 → CONCILIADO; 0.60–0.85 → PROBABLE (requiere un clic de confirmación); < 0.60 → SIN_IDENTIFICAR.
- Regla de seguridad: si dos o más candidatos comparten el mismo monto y puntaje similar, nunca conciliar automáticamente. Marcar PROBABLE y mostrar los candidatos.
- Pagos parciales de mayoristas: aplicar al comprobante más antiguo del cliente y actualizar el saldo.
- Al confirmar manualmente un PROBABLE, guardar el nombre del ordenante como alias y la cuenta de origen en `CuentaOrigenCliente` para aprender.
- Explicabilidad: cada conciliación muestra por qué ("monto exacto + referencia F001-2345").

### 3. Alertas de pago recibido
- Notificación en pantalla con sonido en la caja cuando se concilia un pago de un pedido abierto.
- Panel de alertas para tesorería: pagos SIN_IDENTIFICAR con más de 15 minutos de antigüedad, montos inusualmente altos y pagos duplicados.
- Aviso de pago conciliado al **vendedor** asignado y al **cliente** (si dio consentimiento) por WhatsApp y/o correo.
- Interfaz `CanalNotificacion` con implementaciones funcionales desde el inicio:
  - `CanalPantalla`: evento SSE a la caja.
  - `CanalWhatsApp`: WhatsApp Cloud API de Meta (mensajes con plantilla aprobada). Se activa con `WHATSAPP_CLOUD_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
  - `CanalCorreo`: SMTP con nodemailer. Se activa con las variables `SMTP_*`.
  - Sin credenciales, WhatsApp y correo usan `CanalSimulado`, que guarda el mensaje en la bandeja y se ve en la UI ("mensajes enviados"), para demostrar el flujo completo.
- Envío asíncrono por la bandeja `Notificacion` (patrón outbox) con reintentos, para que una falla de WhatsApp o del correo nunca bloquee la conciliación.
- Webhooks salientes firmados (`pago.conciliado`, `alerta.creada`) para que otros sistemas se enteren.

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
- F0: Scaffold del monorepo (API Fastify + web Angular), lint, `.env.example`, scripts `dev`, `test` y `seed`. Base de seguridad: helmet, CORS con lista blanca, rate limit, `/api/v1`, OpenAPI y Sentry opcional.
- F1: Esquema Prisma, `BankProvider`, `MockBankProvider` con simulador y seed (incluye usuarios de demo por rol).
- F2: Autenticación JWT + refresh, roles, auditoría con hash encadenado. Login en Angular con guards e interceptor.
- F3: Endpoint SSE y módulo 1 (monitor).
- F4: Motor de conciliación con tests unitarios (casos del modo presentación como tests), señal de cuenta de origen y módulo 2.
- F5: Módulo 3 (alertas, bandeja outbox, WhatsApp, correo y webhooks firmados).
- F6: Módulo 4 (validación de proveedores).
- F7: Módulo 5 (posición de caja).
- F8: Modo presentación, stubs `BcpRestProvider` y `BcpH2HProvider`, guía de despliegue con Cloudflare y README con instrucciones de demo.

## Pendientes que dependen del BCP (no bloquean la demo)
- Documentación oficial, credenciales y sandbox (las gestiona Dely con su ejecutivo de banca empresas).
- Confirmar si el acceso será por API REST, por Host-to-Host o por ambos.
- Confirmar si hay notificación push (webhook) o solo consulta periódica, y con qué latencia.
- Confirmar qué campos llegan en movimientos de Yape y Plin (nombre, documento y cuenta de origen del ordenante).

## Pendientes que dependen de Dely (no bloquean la demo)
- Cuenta de WhatsApp Business verificada y plantillas aprobadas por Meta.
- Servidor SMTP corporativo o servicio de correo transaccional.
- Dominio y cuenta de Cloudflare para el despliegue.