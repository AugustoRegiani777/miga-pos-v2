-- BORRADOR — NO correr todavía. Se corre cuando haya una vía real de integración (ver README.md).
-- Regla del proyecto: primero la tabla, despues el codigo que la usa (un push fallido traba la cola).
--
-- Guarda cada intento de cobro con tarjeta, para conciliar el cierre de caja contra el posnet.
-- Es un registro de auditoria: se agrega, no se edita ni se borra (igual que el ledger de stock).

CREATE TABLE IF NOT EXISTS cobros_tarjeta (
  id                    BIGSERIAL PRIMARY KEY,
  uuid                  UUID NOT NULL UNIQUE,          -- identidad del intento (idempotencia entre reintentos)
  venta_uuid            UUID,                           -- la venta que se confirmo con este cobro (null si no se concreto)
  proveedor             TEXT NOT NULL,                  -- 'guiado' | 'simulador' | 'terminal'
  terminal_id           TEXT,
  importe_centavos      INTEGER NOT NULL CHECK (importe_centavos > 0),
  estado                TEXT NOT NULL CHECK (estado IN ('enviado','en_terminal','aprobado','rechazado','cancelado','expirado','manual')),
  autorizacion          TEXT,
  ultimos4              TEXT,
  marca                 TEXT,
  referencia_operacion  TEXT,                           -- la que devuelve el proveedor / sale en el ticket de Postnet
  motivo                TEXT,
  fecha                 DATE NOT NULL DEFAULT CURRENT_DATE,
  creado_en             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cobros_tarjeta_fecha_idx ON cobros_tarjeta (fecha);
CREATE INDEX IF NOT EXISTS cobros_tarjeta_venta_idx ON cobros_tarjeta (venta_uuid);

ALTER TABLE cobros_tarjeta ENABLE ROW LEVEL SECURITY;
CREATE POLICY cobros_tarjeta_select ON cobros_tarjeta FOR SELECT TO authenticated USING (true);
CREATE POLICY cobros_tarjeta_insert ON cobros_tarjeta FOR INSERT TO authenticated WITH CHECK (true);
-- Sin UPDATE ni DELETE a proposito: un cobro registrado no se reescribe.
