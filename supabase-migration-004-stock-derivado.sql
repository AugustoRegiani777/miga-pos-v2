-- =========================================
-- Miga POS v2 — Migracion 004: stock_productos se calcula solo desde movimientos_stock
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- Hasta ahora la tablet subia el stock de dos formas independientes: (1) el
-- detalle de cada movimiento (venta/produccion/ajuste) a movimientos_stock, y
-- (2) por separado, una foto del total actual directo a stock_productos. Si
-- (1) fallaba por wifi y quedaba en cola de reintento pero (2) sí llegaba,
-- stock_productos mostraba un numero sin la fila de movimientos_stock que lo
-- explica — eso es lo que aparecio como "stock negativo" al reconstruir el
-- historial del 30-31/08 y otros dias de agosto.
--
-- Esta migracion hace que stock_productos deje de recibir esa foto aparte:
-- de ahora en mas se calcula automaticamente, dentro de la misma base, a
-- partir de la fila de movimientos_stock que llega. Un solo camino, sin
-- posibilidad de que el total y su propio historial se contradigan.
--
-- El guard por creado_en evita que un movimiento que llega tarde (reintento
-- de la cola offline) pise con un valor viejo un total mas nuevo que ya
-- llego por otro camino.
CREATE OR REPLACE FUNCTION stock_productos_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.producto_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO stock_productos (id, stock_actual, actualizado_en)
  VALUES (NEW.producto_id, NEW.stock_nuevo, NEW.creado_en)
  ON CONFLICT (id) DO UPDATE
    SET stock_actual = EXCLUDED.stock_actual,
        actualizado_en = EXCLUDED.actualizado_en
    WHERE stock_productos.actualizado_en IS NULL
       OR stock_productos.actualizado_en <= EXCLUDED.actualizado_en;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_productos_desde_movimiento ON movimientos_stock;
CREATE TRIGGER trg_stock_productos_desde_movimiento
  AFTER INSERT OR UPDATE ON movimientos_stock
  FOR EACH ROW
  EXECUTE FUNCTION stock_productos_desde_movimiento();
