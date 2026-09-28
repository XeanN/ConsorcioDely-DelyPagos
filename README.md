# Dely Pagos

Prototipo de verificación y conciliación de pagos para Consorcio Dely S.A.C. Complementa al ERP existente (no lo reemplaza).

> **Modo demostración:** mientras no exista convenio de APIs con el BCP, los datos bancarios son simulados (`BANK_PROVIDER=mock`).

## Módulos

1. **Monitor de movimientos** en tiempo real (SSE), con filtros, totales del día y búsqueda por monto.
2. **Conciliación automática** contra pedidos en caja y comprobantes pendientes (monto, nombre del ordenante, referencia y cuenta de origen).
3. **Alertas de pago recibido** en pantalla, por WhatsApp y por correo al vendedor y al cliente, además de webhooks firmados para otros sistemas.
4. **Validación de cuenta de proveedores** por CCI antes de pagar.
5. **Posición de caja**: saldos, ingresos del día y cuentas por cobrar por antigüedad.

## Stack

- **API:** Node + TypeScript + Fastify + Prisma, REST versionado en `/api/v1` con contrato OpenAPI.
- **Web:** Angular (standalone + signals) + Tailwind.
- **Seguridad:** helmet (CSP, HSTS), CORS con lista blanca, rate limit, validación con Zod, JWT con roles y auditoría. Sentry opcional sin datos personales. Detalle en [CLAUDE.md](CLAUDE.md#seguridad-amenaza--control).

## Requisitos

- Node.js 24 LTS
- npm 11 o superior

## Base de datos (PostgreSQL en Neon)

1. Crear un proyecto en [neon.tech](https://neon.tech): nombre `dely-pagos`, PostgreSQL 17, región **AWS São Paulo (sa-east-1)**.
2. Crear la base `dely_pagos` desde la consola de Neon.
3. En **Connect**, copiar la cadena *pooled* en `DATABASE_URL` y la *direct* en `DIRECT_URL` del `.env`. Ambas deben terminar en `?sslmode=require`.
4. El `.env` **nunca** se sube al repositorio. Para otra PC, compártalo por un canal seguro.

## Inicio rápido

```bash
cp .env.example .env      # y completar DATABASE_URL, DIRECT_URL y SEED_CLAVE_DEMO
npm install
npm run db:desplegar      # crea las tablas
npm run seed              # carga datos de demostración
npm run dev
```

Para ver los datos: la consola web de Neon o `npm run db:estudio -w apps/api`.

- Web: http://localhost:4200
- API: http://localhost:4000/api/v1/salud
- Contrato OpenAPI: http://localhost:4000/api/docs

## Scripts

| Script              | Descripción                            |
| ------------------- | -------------------------------------- |
| `npm run dev`       | Levanta API y web en modo desarrollo   |
| `npm test`          | Ejecuta los tests (Vitest)             |
| `npm run seed`      | Carga datos semilla                    |
| `npm run lint`      | Revisa el código con ESLint            |
| `npm run typecheck` | Verifica tipos en todos los workspaces |
| `npm run build`     | Compila API y web para producción      |

## Estructura

```
apps/
  api/   Fastify + Prisma + TypeScript
  web/   Angular + Tailwind
docs/
  contrato-api-bancaria.yaml   Contrato PROVISIONAL propio (no es la API oficial del BCP)
```
