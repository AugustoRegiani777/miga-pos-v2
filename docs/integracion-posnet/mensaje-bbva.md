# Mensaje para BBVA — integración del terminal con la caja

> Para enviar a tu gestor de BBVA Empresas / soporte TPV. Completá lo que está entre [corchetes].
> Si te piden "qué necesito exactamente", la respuesta corta está en la sección **"Qué queremos lograr"**.

---

**Asunto:** Consulta técnica — integración del TPV Android (PAX A910S) con nuestro software de caja

Hola [nombre del gestor]:

Somos **Uno de Miga** ([CIF/NIF]), una sandwichería en Valencia, cliente de BBVA. Tenemos contratado el TPV Android con un terminal **PAX A910S** (app *BBVA Cobros*):

- Nº de comercio (FUC): [FUC]
- Nº de terminal: [terminal]
- Titular de contrato: [titular]

## Qué queremos lograr

Usamos un sistema de caja propio (aplicación web que corre en una tablet Android). Hoy, cuando el cliente paga con tarjeta, quien cobra **tiene que teclear a mano el importe en el terminal**. Queremos que el importe del carrito viaje **automáticamente al terminal** y que el sistema reciba el **resultado de la operación**:

1. En la caja se elige "Tarjeta" y se pulsa "Cobrar".
2. El terminal muestra solo el importe y espera la tarjeta del cliente.
3. El terminal devuelve a la caja: **aprobada / denegada / cancelada**, y si es posible el código de autorización, los últimos 4 dígitos, la marca de la tarjeta y la referencia de la operación.

Con eso conciliamos automáticamente el cierre de caja contra el cierre del TPV, sin tipear nada.

## Lo que nos importa (y lo que NO necesitamos)

- **No queremos tocar datos de tarjeta.** El PAN, el PIN y el chip se procesan solo en el terminal; nuestro sistema solo manda un importe y recibe un resultado. (Entendemos que así queda fuera de nuestro alcance PCI.)
- No necesitamos cambiar de banco ni de terminal si BBVA ofrece una vía de integración para este modelo.

## Preguntas concretas

1. ¿El **TPV Android PAX A910S** de BBVA admite que **una aplicación de gestión envíe el importe** al cobro? ¿Cómo (API, SDK, intent de Android, integración "semi-integrada")?
2. ¿La app **BBVA Cobros** expone alguna **interfaz para integradores** (por ejemplo, una *intent* de Android con el importe y una referencia, y un resultado de vuelta)? ¿Hay documentación?
3. ¿Existe una integración tipo **Redsys "TPV-PC" / "TPV PC Avanzado"** o una **API en la nube** que funcione con este terminal por red (Wi-Fi)? ¿Requiere contratar algo adicional?
4. Si no es posible con nuestro software, ¿qué **integradores o software de gestión certificados por BBVA** (por ejemplo Revo u otros) lo hacen con este terminal, y con qué condiciones?
5. ¿Hay **entorno de pruebas (sandbox)** y credenciales para desarrolladores? ¿A quién escribimos?
6. ¿La integración tiene **coste** (licencia, alta, cuota mensual o comisión)? ¿Cambia la tarifa del TPV?
7. ¿Qué datos devuelve el terminal al sistema (autorización, últimos 4 dígitos, marca, referencia) y cómo se **identifica una operación** para evitar duplicados ante un reintento o un corte de red?

## Nuestro entorno técnico (por si lo piden)

- Aplicación web (PWA) en una tablet Android, conexión Wi-Fi del local; backend en la nube (funciones serverless y base de datos propia).
- Podemos exponer un *endpoint* HTTPS para recibir notificaciones (webhook) y consumir una API REST/JSON.
- Preferimos un esquema de **petición/respuesta por API** (crear cobro → consultar estado → cancelar), con **idempotencia** por referencia de venta.

Quedamos atentos. Si es más sencillo, podemos agendar una llamada con alguien técnico.

Muchas gracias,
[Nombre y apellido]
Uno de Miga — [teléfono] — [email]
