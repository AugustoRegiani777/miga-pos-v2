-- Migracion 017: marca de tiempo en productos y categorias
--
-- Para poder avisar "hay 3 cambios en el menu" ANTES de descargarlos, hace
-- falta poder preguntarle a la nube "que cambio desde la ultima vez que
-- mire". Hoy es imposible para productos y categorias: son las dos unicas
-- tablas del catalogo sin ninguna columna de fecha (insumos, recetas,
-- proveedores y configuracion_compartida ya tienen actualizado_en).
--
-- OJO CON EL TRIGGER — es la parte importante:
-- La app hace pushCatalogoSnapshot (un upsert de TODOS los productos) cada
-- vez que arranca y cada vez que se guarda cualquier cosa del menu. Con un
-- trigger ingenuo ("en cada UPDATE, actualizado_en = NOW()"), ese upsert
-- marcaria los 41 productos como cambiados aunque no cambie ni una coma — y
-- el otro dispositivo veria "41 cambios en el menu" cada vez que alguien
-- abre la app. La funcion de abajo compara la fila vieja contra la nueva
-- (ignorando la propia columna de fecha) y solo mueve la marca si algo
-- cambio de verdad. Sin esto, la notificacion entera seria ruido.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE productos  ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE categorias ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION marcar_actualizado_en() RETURNS TRIGGER AS $$
BEGIN
  IF (to_jsonb(NEW) - 'actualizado_en') IS DISTINCT FROM (to_jsonb(OLD) - 'actualizado_en') THEN
    NEW.actualizado_en := NOW();
  ELSE
    NEW.actualizado_en := OLD.actualizado_en;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS productos_marcar_actualizado ON productos;
CREATE TRIGGER productos_marcar_actualizado
  BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

DROP TRIGGER IF EXISTS categorias_marcar_actualizado ON categorias;
CREATE TRIGGER categorias_marcar_actualizado
  BEFORE UPDATE ON categorias
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

CREATE INDEX IF NOT EXISTS idx_productos_actualizado_en  ON productos (actualizado_en);
CREATE INDEX IF NOT EXISTS idx_categorias_actualizado_en ON categorias (actualizado_en);

NOTIFY pgrst, 'reload schema';
