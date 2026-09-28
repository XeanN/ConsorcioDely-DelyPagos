# Dely Pagos

Prototipo de verificación y conciliación de pagos para Consorcio Dely S.A.C. Complementa al ERP existente (no lo reemplaza).

> **Modo demostración:** mientras no exista convenio de APIs con el BCP, los datos bancarios son simulados (`BANK_PROVIDER=mock`).

## Módulos

1. **Monitor de movimientos** en tiempo real (SSE), con filtros, totales del día y búsqueda por monto.
2. **Conciliación automática** contra pedidos en caja y comprobantes pendientes (monto, nombre del ordenante, referencia).
3. **Alertas** de pago recibido en pantalla (WhatsApp y correo como fase posterior).
4. **Validación de cuenta de proveedores** por CCI antes de pagar.
5. **Posición de caja**: saldos, ingresos del día y cuentas por cobrar por antigüedad.

## Requisitos

- Node.js 20 o superior
- npm 10 o superior

## Inicio rápido

```bash
cp .env.example .env
npm install
npm run seed
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000/api/salud

## Scripts

| Script              | Descripción                           |
| ------------------- | ------------------------------------- |
| `npm run dev`       | Levanta API y web en modo desarrollo  |
| `npm test`          | Ejecuta los tests (Vitest)            |
| `npm run seed`      | Carga datos semilla                   |
| `npm run lint`      | Revisa el código con ESLint           |
| `npm run typecheck` | Verifica tipos en todos los workspaces |

## Estructura

```
apps/
  api/   Fastify + Prisma + TypeScript
  web/   React + Vite + Tailwind
docs/
  contrato-api-bancaria.yaml   Contrato PROVISIONAL propio (no es la API oficial del BCP)
```
