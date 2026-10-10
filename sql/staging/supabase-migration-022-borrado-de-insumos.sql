-- Migracion 022: permitir borrar un insumo y una linea de proveedor
--
-- Continuacion directa de la 021, que abrio el borrado para `productos` y
-- `recetas`. Faltaba el otro lado del catalogo: un insumo que se cargo por
-- error (probando el alta, o leyendo mal una factura) no se puede sacar.
--
-- Hoy solo se puede DESACTIVAR (`descartarInsumo`), que es lo correcto para un
-- insumo con historial: el stock se deriva del ledger y borrar algo con
-- movimientos dejaria esos movimientos apuntando al vacio. Pero para uno que
-- nunca se uso, desactivarlo lo deja para siempre en la lista, ensuciando la
-- pantalla de Insumos y la de Proveedores.
--
-- LA MISMA TRAMPA DE LA 021, por si alguien la lee suelta:
-- un DELETE que RLS no permite NO devuelve error. PostgREST contesta 204, igual
-- que si hubiera borrado, porque para la politica "no habia ninguna fila que
-- borrar". Por eso `deleteInsumoRemoto()` y `deleteProveedorInsumoRemoto()`
-- releen despues de borrar y fallan si la fila sigue ahi. Esa verificacion se
-- queda aunque exista la politica.
--
-- QUE SIGUE SIENDO IMPOSIBLE:
--   * `movimientos_insumos` NO tiene DELETE y no lo va a tener: es el ledger.
--     Con la conexion a Hacienda en camino, es append-only.
--   * La FK sin cascada desde `movimientos_insumos` y `recetas` hacia
--     `insumos(id)` impide borrar cualquier insumo con historial o con receta:
--     Postgres lo rechaza con 23503. La app ademas lo chequea antes y, si tiene
--     movimientos, ni lo intenta.
--
-- O sea: solo se puede borrar un insumo que nunca se uso.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.
--
-- OJO AL PASAR A PRODUCCION: repetirla alla, junto con la 014 a la 021.

DROP POLICY IF EXISTS insumos_delete ON insumos;
CREATE POLICY insumos_delete
  ON insumos FOR DELETE TO authenticated USING (true);

-- Una linea de proveedor ("este proveedor me vende este insumo a este precio")
-- es catalogo puro, sin historial colgando. Se borra sola, tenga o no insumo.
DROP POLICY IF EXISTS proveedor_insumos_delete ON proveedor_insumos;
CREATE POLICY proveedor_insumos_delete
  ON proveedor_insumos FOR DELETE TO authenticated USING (true);

-- `stock_insumos` es DERIVADA (la mantiene el trigger que suma
-- `movimientos_insumos`). Su fila tiene que irse con el insumo; si quedara,
-- el proximo calculo encontraria una fila sin dueño. Mismo criterio que
-- stock_productos en la 021.
DROP POLICY IF EXISTS stock_insumos_delete ON stock_insumos;
CREATE POLICY stock_insumos_delete
  ON stock_insumos FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
