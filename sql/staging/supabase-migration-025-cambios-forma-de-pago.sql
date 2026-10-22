-- Migracion 025: corregir la forma de pago de una venta, con registro de cada cambio
--
-- Desde el Cierre se puede corregir la forma de pago de una venta cargada mal (efectivo / tarjeta /
-- Glovo / Bizum). Solo cambia ESE dato: la venta no se duplica, no se toca el stock ni el total.
--
-- Como la forma de pago mueve el cierre de caja (efectivo esperado, posnet), cada correccion queda
-- anotada en esta tabla: que venta, de que forma a cual, cuando. Es solo de agregar (sin UPDATE ni
-- DELETE): nada se edita en silencio.
--
-- AVISO PARA EL DASHBOARD (miga-dashboard): ventas.forma_pago de una venta puede cambiar despues de
-- creada. Es de solo lectura, no se rompe, pero un dia ya consultado puede reacomodar sus totales
-- por forma de pago.
--
-- IMPORTANTE: correr ESTO ANTES de publicar el codigo. Si la app intenta anotar un cambio y la tabla
-- no existe, el envio falla y queda trabado en la cola.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

CREATE TABLE IF NOT EXISTS cambios_forma_pago (
  id              BIGSERIAL PRIMARY KEY,
  uuid            TEXT UNIQUE NOT NULL,
  venta_uuid      TEXT NOT NULL,
  fecha_venta     TEXT NOT NULL,
  forma_anterior  TEXT NOT NULL,
  forma_nueva     TEXT NOT NULL,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cambios_forma_pago_venta_idx ON cambios_forma_pago (venta_uuid);

ALTER TABLE cambios_forma_pago ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cambios_forma_pago_select ON cambios_forma_pago;
DROP POLICY IF EXISTS cambios_forma_pago_insert ON cambios_forma_pago;
CREATE POLICY cambios_forma_pago_select ON cambios_forma_pago FOR SELECT TO authenticated USING (true);
CREATE POLICY cambios_forma_pago_insert ON cambios_forma_pago FOR INSERT TO authenticated WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
