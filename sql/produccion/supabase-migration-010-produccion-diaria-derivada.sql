-- =========================================
-- Miga POS v2 — Migracion 010: produccion_diaria se calcula sola
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- Hasta ahora produccion_diaria.cantidad era un contador que cada
-- dispositivo mantenia por su cuenta y empujaba entero (upsert por id
-- "fecha:producto_id") — si dos dispositivos cargaban produccion del mismo
-- producto el mismo dia, gana el que empujo ultimo, sin sumar al otro. Causa
-- raiz confirmada de los incidentes del 13/09, 15/09 y 19/09/2026 (ver
-- conversacion/memoria del proyecto): el numero de la app no coincidia con
-- la suma de sus propias lineas de movimientos_stock.
--
-- Mismo principio que ya se aplico para stock_productos en la migracion 004:
-- en vez de que la app le diga a Supabase "yo creo que el total es X", un
-- trigger en Supabase lo calcula solo a partir de cada fila que llega a
-- movimientos_stock. Nadie puede pisarlo porque nadie escribe el total.
--
-- Solo AFTER INSERT (nunca UPDATE): un reintento de sync que en realidad ya
-- se habia guardado hace un upsert por uuid, que en Postgres es un UPDATE si
-- la fila ya existe — si el trigger tambien corriera en UPDATE, ese reintento
-- sumaria la misma produccion dos veces. Con solo INSERT, un reintento sobre
-- una fila que ya existe no vuelve a sumar nada (correcto: esa produccion ya
-- se conto la primera vez que la fila se creo).
CREATE OR REPLACE FUNCTION produccion_diaria_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo != 'produccion' OR NEW.producto_id IS NULL OR NEW.fecha IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO produccion_diaria (id, producto_id, fecha, cantidad, creado_en, actualizado_en)
  VALUES (NEW.fecha || ':' || NEW.producto_id, NEW.producto_id, NEW.fecha, NEW.cantidad, NEW.creado_en, NEW.creado_en)
  ON CONFLICT (id) DO UPDATE
    SET cantidad = produccion_diaria.cantidad + EXCLUDED.cantidad,
        actualizado_en = GREATEST(produccion_diaria.actualizado_en, EXCLUDED.actualizado_en);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_produccion_diaria_desde_movimiento ON movimientos_stock;
CREATE TRIGGER trg_produccion_diaria_desde_movimiento
  AFTER INSERT ON movimientos_stock
  FOR EACH ROW
  EXECUTE FUNCTION produccion_diaria_desde_movimiento();
