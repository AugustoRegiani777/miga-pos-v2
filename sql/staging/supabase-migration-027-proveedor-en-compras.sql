-- Migracion 027: a quien se le compro cada vez que entro mercaderia
--
-- Hoy una compra de insumo guarda cuanto, cuando y el stock antes y despues, pero NO a quien se le compro. Sin
-- eso no se puede saber "quien fue el ultimo proveedor de este insumo". Se agrega el proveedor a la compra.
-- Sin clave foranea a proposito: una FK haria fallar el envio (23503) si el proveedor todavia no subio, y un
-- envio trabado apaga la reconciliacion de stock (CLAUDE.md 8.7). Lo viejo queda en NULL.
--
-- AVISO PARA EL DASHBOARD (miga-dashboard): columna nueva en `movimientos_insumos`. Solo lectura, no se rompe.
--
-- IMPORTANTE: correr ESTO ANTES de publicar el codigo. Si la app sube una compra con proveedor_id y la columna no
-- existe, el envio falla (PGRST204) y queda trabado en la cola.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE movimientos_insumos ADD COLUMN IF NOT EXISTS proveedor_id TEXT;

NOTIFY pgrst, 'reload schema';
