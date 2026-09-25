-- =========================================
-- Miga POS v2 — Migracion 009: constraint incompleto + FK faltante
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- 1) movimientos_insumos.tipo rechazaba 'devolucion' y 'calibracion', dos
-- tipos que el codigo SI genera (restoreInsumosInTx al deshacer una venta de
-- cafe/bebida, y calibrarInsumo). Confirmado con los datos reales: 997 filas
-- "produccion" y 3 "venta" en Supabase, CERO "devolucion" o "calibracion" —
-- cada intento de subir esas dos fallaba con 23514 (check_violation) y
-- quedaba reintentando para siempre sin poder llegar nunca.
ALTER TABLE movimientos_insumos DROP CONSTRAINT IF EXISTS chk_movinsumos_tipo;
ALTER TABLE movimientos_insumos ADD CONSTRAINT chk_movinsumos_tipo
  CHECK (tipo IN ('compra', 'desperdicio', 'no_recibido', 'error_conteo', 'produccion', 'venta', 'devolucion', 'calibracion'));

-- 2) recetas.producto_id nunca tuvo foreign key (a diferencia de
-- produccion_diaria/movimientos_stock/stock_productos/detalle_pedido, que ya
-- la tienen desde la migracion 002) — auditado contra los datos reales antes
-- de escribir esto: 0 filas la violarian.
ALTER TABLE recetas ADD CONSTRAINT fk_recetas_producto
  FOREIGN KEY (producto_id) REFERENCES productos(id);

-- Postgres no indexa solo por tener una FK — se agrega a mano, mismo criterio
-- que ya se uso para categoria_id en productos (migracion 002).
CREATE INDEX IF NOT EXISTS idx_recetas_producto_id ON recetas(producto_id);
