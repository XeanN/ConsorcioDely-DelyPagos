# Integración del ERP con Dely Pagos

Guía para quien conecte el ERP de Dely (u otro sistema) con Dely Pagos. El ERP **no se reemplaza**: solo envía los pedidos de caja y los comprobantes emitidos, para que los abonos del banco se concilien contra ellos automáticamente.

## 1. Obtener credenciales

Un administrador entra a **Integraciones** en Dely Pagos, crea la integración con los permisos necesarios y entrega por un medio seguro el `client_id` y el `client_secret`. El secreto se muestra una sola vez; si se pierde o se filtra, se usa **Regenerar secreto** y el anterior deja de funcionar al instante.

| Permiso (alcance) | Permite |
|---|---|
| `pedidos` | Registrar pedidos en caja que esperan pago y consultarlos |
| `comprobantes` | Enviar facturas y boletas emitidas |
| `movimientos:leer` | Consultar los abonos recibidos y su estado de conciliación |

Un sistema **nunca** puede entrar a las pantallas de personas: usuarios, confirmación de pagos ni auditoría.

## 2. Pedir un token (OAuth2 client credentials)

```bash
curl -X POST https://<servidor>/api/v1/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$DELY_CLIENT_ID" \
  -d "client_secret=$DELY_CLIENT_SECRET"
```

Respuesta:

```json
{ "access_token": "eyJ…", "token_type": "Bearer", "expires_in": 900, "scope": "pedidos comprobantes" }
```

- El token dura 15 minutos: pedir uno nuevo cuando venza (o cuando la API responda `401`).
- También se aceptan las credenciales en la cabecera `Authorization: Basic base64(client_id:client_secret)`.
- Nunca guardar el secreto en el código del conector: usar variables de entorno o el gestor de secretos del servidor.

## 3. Registrar un pedido en caja

Cuando el cajero registra en el ERP una venta que se pagará por Yape, Plin o transferencia:

```bash
curl -X POST https://<servidor>/api/v1/pedidos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "idExterno": "PED-2026-000123",
    "monto": 350.00,
    "moneda": "PEN",
    "tienda": "Tienda Central",
    "caja": "Caja 1",
    "clienteDocumento": { "tipoDoc": "DNI", "numeroDoc": "45678912" }
  }'
```

- **`idExterno`** es el número del pedido en el ERP. Si el conector reenvía el mismo pedido (por un corte de red, por ejemplo), la API responde `200` con `"duplicado": true` y **no lo crea dos veces**. Siempre enviarlo.
- `clienteDocumento` es opcional (venta a consumidor sin identificar).
- Cuando llega el abono, el pedido pasa a `PAGADO` solo y la caja lo ve al instante.

## 4. Enviar comprobantes emitidos

Enviar las facturas y boletas nuevas o modificadas, en lotes de hasta 500:

```bash
curl -X POST https://<servidor>/api/v1/integracion/comprobantes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "comprobantes": [{
      "tipo": "FACTURA", "serie": "F001", "numero": 2345,
      "fechaEmision": "2026-09-01", "fechaVencimiento": "2026-10-01",
      "total": 5000.00, "saldoPendiente": 5000.00, "moneda": "PEN",
      "cliente": { "tipoDoc": "RUC", "numeroDoc": "20512345678", "nombre": "DISTRIBUIDORA HUAMAN PUNO S.A.C." }
    }]
  }'
```

- Es **idempotente**: reenviar el mismo lote no duplica nada (`sinCambios`).
- Si el cliente no existe, se crea con esos datos.
- Si Dely Pagos ya aplicó pagos a un comprobante, **conserva su propio saldo** y lo informa en `conservados`, para no deshacer cobros ya registrados.
- Se valida el RUC con su dígito verificador y el formato de la serie (`F001`, `B001`).

## 5. Consultar abonos (opcional)

Con el permiso `movimientos:leer`:

```bash
curl "https://<servidor>/api/v1/movimientos?fecha=2026-09-30&estado=CONCILIADO" -H "Authorization: Bearer $TOKEN"
```

Los datos personales del ordenante llegan enmascarados.

## Recomendaciones para el conector

- Un proceso pequeño (por ejemplo, una tarea programada cada minuto) que lea los pedidos y comprobantes nuevos del ERP y los envíe. No hace falta modificar el ERP si se puede leer su base de datos o sus exportaciones.
- Reintentar con espera creciente ante errores de red o `5xx`; nunca ante `400` (el dato es inválido y hay que corregirlo).
- Respetar el límite de peticiones: si la API responde `429`, esperar y reintentar.
- El contrato completo, con todos los campos y respuestas, está en `/api/docs` (OpenAPI).
