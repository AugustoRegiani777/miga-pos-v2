# Cobro con tarjeta: conexión caja ⇄ posnet (PAX A910S de BBVA)

Estado: **preparado, a la espera de la vía real de BBVA.** La app ya sabe pedir un cobro y esperar el
resultado; lo que falta es el adaptador del proveedor real (se hace cuando BBVA entregue la documentación).

## Cómo funciona (igual que las integraciones de terminal por API)

```
Caja (tablet)            Función cobro-terminal (Netlify)        Terminal / proveedor
   |  Tarjeta → Cobrar          |                                       |
   |--- crear (importe, ref) -->|--- POST /cobros (Idempotency-Key) --->|  muestra el importe
   |<-- {id, enviado} ----------|                                       |
   |--- estado (cada 1 s) ----->|--- GET /cobros/{id} ----------------->|
   |<-- en_terminal ... --------|                                       |  el cliente paga
   |<-- aprobado + autorización |<--------------------------------------|
   |  confirma la venta         |
```

- La **clave del proveedor nunca está en la tablet**: vive en variables de entorno de Netlify y solo la
  función la usa. La función exige estar logueado (token de Supabase).
- **Idempotencia:** cada intento lleva una `referencia` (UUID). Si se corta la red y se reintenta, no se
  cobra dos veces.
- **Estados finales:** `aprobado`, `rechazado`, `cancelado`, `expirado`. Solo `aprobado` confirma la venta.
- Si algo falla (sin red, el terminal no responde), siempre queda la salida manual: *"Cobrar a mano"*.

## Modos (por dispositivo, NO se muestra en pantalla: se cambia abriendo la app con `?posnet=guiado|simulador|terminal|ninguno`, ver COMANDOS.md)

| Modo | Qué hace | Para qué |
|---|---|---|
| **Sin posnet** | Como hoy: se elige Tarjeta y se confirma la venta. | Predeterminado. |
| **Guiado** | Al confirmar con Tarjeta aparece el monto grande: *"Cobrá 12,40 € en el posnet"*; la persona toca **Cobrado ✓** o Cancelar. | Evita tipear mal el monto. Sirve desde hoy, sin BBVA. |
| **Simulador** | Simula un terminal (se envía → en el terminal → aprobado, o rechazado). | Probar todo el flujo sin terminal. |
| **Terminal** | Usa la función `cobro-terminal` con el proveedor real. | Cuando BBVA entregue la integración. |

## Vías de conexión posibles (de más a menos recomendable)

1. **API en la nube del proveedor** (semi-integrado). Es el contrato de `openapi-cobros.yaml`. Es lo que
   piden las integraciones modernas (Stripe Terminal, Adyen, Redsys por webservice). *Necesita que BBVA
   habilite el terminal para eso.*
2. **Redsys TPV-PC / TPV PC Avanzado** por webservice, si BBVA lo habilita para este modelo.
3. **Puente Android (intent):** si la app *BBVA Cobros* expone una *intent* con importe y referencia y
   devuelve el resultado. Requeriría una app contenedora nativa en el terminal. *Depende de BBVA.*
4. **Cambiar de proveedor** (Stripe Terminal, Adyen, SumUp, Viva…): solo si BBVA no ofrece nada.
   Implica contrato y terminal nuevos.

Mensaje listo para enviar: [`mensaje-bbva.md`](mensaje-bbva.md).

## Qué se hace cuando llegue la documentación

1. Completar las variables en Netlify: `COBRO_PROVEEDOR=generico`, `COBRO_API_URL`, `COBRO_API_KEY`,
   `COBRO_TERMINAL_ID` (y `COBRO_WEBHOOK_SECRET` si usan webhook).
2. Ajustar en `netlify/functions/cobro-terminal.js` el **mapeo** de campos y de estados del proveedor
   (`ESTADOS_PROVEEDOR`, `aCobro()`): es lo único específico.
3. Probar con el modo **Terminal** en un cobro de prueba.
4. (Opcional) correr `migracion-cobros-tarjeta.sql` para guardar autorización, últimos 4 y referencia en
   cada venta y conciliar el cierre contra Postnet automáticamente.
