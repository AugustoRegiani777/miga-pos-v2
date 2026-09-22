-- =========================================
-- Miga POS v2 — Migracion 012 (PARTE 1/2): stock_insumos separado y derivado
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente. Segura de correr ya,
-- ANTES de deployar el codigo nuevo (ver PARTE 2 en la migracion 013 — esa
-- si es destructiva y hay que esperar).
-- =========================================
--
-- PROBLEMA (confirmado con datos reales, caso "atun", 22/09/2026):
-- insumos.stock_actual vive en la MISMA fila que la definicion del insumo
-- (nombre, unidad, minimos). Por eso, 8 lugares del codigo que empujan "la
-- definicion actualizada" a Supabase (crear un insumo, confirmar una
-- factura, calibrar, editar un proveedor, agregar una variante, e incluso
-- CADA VEZ QUE SE ABRE LA APP en bootApp) sin querer arrastran tambien el
-- stock que ESE dispositivo tenia guardado en ESE momento, y lo pisan sin
-- avisar. Es la misma familia de bug que produccion_diaria/stock_productos
-- (ver migracion 010) — un valor derivado que un snapshot completo puede
-- pisar — pero nunca se habia arreglado para insumos.
--
-- SOLUCION: separar insumos (definicion, ya no tiene stock) de stock_insumos
-- (solo el numero en vivo), igual que ya existe para productos/stock_productos.
-- stock_insumos se recalcula SOLO con el trigger de aca abajo, a partir de
-- movimientos_insumos — ningun push de definicion puede volver a tocarlo,
-- porque estructuralmente ese campo ya no va a estar en la misma tabla.
--
-- Por que ADITIVO (sumar cantidad) y no "snapshot con guarda de fecha" como
-- stock_productos: stock_productos asume un solo escritor real (la tablet
-- que opera) y usa el stock_nuevo que ese escritor ya calculo. Insumos NO
-- tiene un solo escritor — el celu escribe compras (factura) y la tablet
-- escribe consumo (produccion/venta/calibracion) AL MISMO TIEMPO, sobre los
-- MISMOS insumos. Con multiples escritores concurrentes, sumar deltas es lo
-- unico que da el mismo resultado sin importar el orden de llegada — mismo
-- principio ya aplicado en produccion_diaria_desde_movimiento (migracion 010).

-- Paso 1: crear la tabla nueva.
CREATE TABLE IF NOT EXISTS stock_insumos (
  id             TEXT PRIMARY KEY REFERENCES insumos(id) ON DELETE CASCADE,
  stock_actual   NUMERIC NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE stock_insumos ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_insumos_select ON stock_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_insumos_insert ON stock_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_insumos_update ON stock_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Paso 2: baseline — copiar el stock_actual QUE HAY HOY en insumos, antes de
-- que la migracion 013 lo borre. Esto es un punto de partida tecnico, no una
-- afirmacion de que ese numero sea correcto (varios insumos ya estan rotos,
-- ver seccion de reparacion de datos aparte) — a partir de aca, cada
-- movimiento nuevo lo corrige solo.
INSERT INTO stock_insumos (id, stock_actual, actualizado_en)
SELECT id, COALESCE(stock_actual, 0), NOW()
FROM insumos
ON CONFLICT (id) DO NOTHING;

-- Paso 3: la funcion + trigger que mantiene stock_insumos derivado.
-- Maneja INSERT, UPDATE y DELETE sobre movimientos_insumos (el ledger es
-- inmutable en la practica — el codigo de la app solo hace INSERT via
-- upsert-por-uuid — pero cubrir los tres casos deja la tabla realmente
-- cerrada: si alguna vez se corrige o se borra una fila a mano desde el SQL
-- Editor, stock_insumos se re-sincroniza solo, nunca queda desfasada).
CREATE OR REPLACE FUNCTION stock_insumos_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE stock_insumos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.insumo_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Un upsert-por-uuid que reintenta la MISMA fila (mismo insumo_id, misma
    -- cantidad) no debe sumar de nuevo — es exactamente el reintento normal
    -- de la cola offline, no una correccion real.
    IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad
       AND NEW.insumo_id IS NOT DISTINCT FROM OLD.insumo_id THEN
      RETURN NEW;
    END IF;
    -- Revertir el delta viejo antes de aplicar el nuevo (cubre tambien el
    -- caso raro de que insumo_id haya cambiado).
    UPDATE stock_insumos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.insumo_id;
  END IF;

  INSERT INTO stock_insumos (id, stock_actual, actualizado_en)
  VALUES (NEW.insumo_id, NEW.cantidad, NOW())
  ON CONFLICT (id) DO UPDATE
    SET stock_actual = stock_insumos.stock_actual + NEW.cantidad,
        actualizado_en = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_insumos_desde_movimiento ON movimientos_insumos;
CREATE TRIGGER trg_stock_insumos_desde_movimiento
  AFTER INSERT OR UPDATE OR DELETE ON movimientos_insumos
  FOR EACH ROW
  EXECUTE FUNCTION stock_insumos_desde_movimiento();

-- Verificacion rapida despues de correr esto (deberia dar 0 filas — todo
-- insumo activo tiene que tener su fila espejo en stock_insumos):
--
-- SELECT i.id FROM insumos i
-- LEFT JOIN stock_insumos si ON si.id = i.id
-- WHERE i.activo AND si.id IS NULL;
