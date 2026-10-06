-- Migracion 018: que la marca de tiempo la decida la BASE, no el cliente
--
-- Problema encontrado al probar las notificaciones (30/09/2026): el
-- dispositivo se avisaba a si mismo de sus propias subidas. Al arrancar, la
-- app sube el catalogo completo (recetas, insumos, proveedores...) y en esas
-- tablas el actualizado_en viaja DENTRO del payload que manda el cliente. Un
-- upsert que no cambia absolutamente nada igual pisaba la fecha con NOW(), y
-- el resultado era "128 cambios" cada vez que alguien abria la app — con lo
-- cual la notificacion entera quedaba inservible.
--
-- La migracion 017 ya resolvio esto para productos y categorias con un
-- trigger que compara la fila vieja contra la nueva. Esta extiende el mismo
-- trigger al resto de las tablas que se vigilan. A partir de aca, la fecha la
-- pone la base solo cuando algo cambio de verdad, sin importar que mande el
-- cliente en el payload (marcar_actualizado_en ignora esa columna al
-- comparar, asi que el valor que manda la app queda descartado).
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.
-- Depende de la funcion marcar_actualizado_en(), creada en la 017.

DROP TRIGGER IF EXISTS recetas_marcar_actualizado ON recetas;
CREATE TRIGGER recetas_marcar_actualizado
  BEFORE UPDATE ON recetas
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

DROP TRIGGER IF EXISTS insumos_marcar_actualizado ON insumos;
CREATE TRIGGER insumos_marcar_actualizado
  BEFORE UPDATE ON insumos
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

DROP TRIGGER IF EXISTS proveedores_marcar_actualizado ON proveedores;
CREATE TRIGGER proveedores_marcar_actualizado
  BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

DROP TRIGGER IF EXISTS proveedor_insumos_marcar_actualizado ON proveedor_insumos;
CREATE TRIGGER proveedor_insumos_marcar_actualizado
  BEFORE UPDATE ON proveedor_insumos
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

DROP TRIGGER IF EXISTS configuracion_compartida_marcar_actualizado ON configuracion_compartida;
CREATE TRIGGER configuracion_compartida_marcar_actualizado
  BEFORE UPDATE ON configuracion_compartida
  FOR EACH ROW EXECUTE FUNCTION marcar_actualizado_en();

CREATE INDEX IF NOT EXISTS idx_recetas_actualizado_en           ON recetas (actualizado_en);
CREATE INDEX IF NOT EXISTS idx_insumos_actualizado_en           ON insumos (actualizado_en);
CREATE INDEX IF NOT EXISTS idx_proveedores_actualizado_en       ON proveedores (actualizado_en);
CREATE INDEX IF NOT EXISTS idx_proveedor_insumos_actualizado_en ON proveedor_insumos (actualizado_en);

NOTIFY pgrst, 'reload schema';
