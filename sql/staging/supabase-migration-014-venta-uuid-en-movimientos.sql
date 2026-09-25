-- Migracion 014: vincular movimientos con su venta por UUID (identidad compartida)
--
-- Hasta ahora movimientos_insumos guardaba venta_id_local (el id autoincremental
-- de la tablet, que solo significa algo en ESA tablet) y movimientos_stock lo
-- escondia en el texto de "referencia" ("Venta #5"). Otro dispositivo (el celu,
-- el dashboard) no podia saber a que venta pertenece cada movimiento. venta_uuid
-- es el mismo uuid que ya tiene ventas.uuid: une ambos lados sin ambiguedad.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.
-- No borra ni modifica ninguna fila existente (las viejas quedan con NULL).

ALTER TABLE movimientos_stock    ADD COLUMN IF NOT EXISTS venta_uuid TEXT;
ALTER TABLE movimientos_insumos  ADD COLUMN IF NOT EXISTS venta_uuid TEXT;

CREATE INDEX IF NOT EXISTS idx_movimientos_stock_venta_uuid   ON movimientos_stock (venta_uuid)   WHERE venta_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_movimientos_insumos_venta_uuid ON movimientos_insumos (venta_uuid) WHERE venta_uuid IS NOT NULL;

-- Recarga el cache de esquema de PostgREST para que la API vea las columnas ya.
NOTIFY pgrst, 'reload schema';
