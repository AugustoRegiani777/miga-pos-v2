-- Migracion 021: permitir borrar un producto de verdad
--
-- El dueño pidio poder ELIMINAR un producto del menu, no solo ocultarlo: "si lo
-- quiere volver a tener debe crearlo de nuevo, con su receta y asignacion de
-- insumos".
--
-- Hoy no se puede. `productos`, `recetas`, `historial_recetas` y
-- `stock_productos` tienen politicas de RLS de SELECT, INSERT y UPDATE, pero
-- NINGUNA de DELETE (a diferencia de `pedidos`, `detalle_pedido` y
-- `movimientos_stock`, que si la tienen).
--
-- LA TRAMPA, que es lo importante de esta migracion:
-- un DELETE que RLS no permite NO devuelve error. PostgREST contesta 204, igual
-- que si hubiera borrado, porque para la politica simplemente "no habia ninguna
-- fila que borrar". La app daba por eliminado un producto que seguia intacto en
-- la nube, y el proximo "Actualizar catalogo" lo devolvia a todos los
-- dispositivos. Por eso `deleteProductoRemoto()` ademas relee despues de
-- borrar: no le cree al 204. Esa verificacion se queda aunque exista la
-- politica — es barata y es la unica forma de saber que paso de verdad.
--
-- ESTO NO ABRE LA PUERTA A BORRAR HISTORIAL FINANCIERO:
--   * `ventas`, `detalle_venta` y `movimientos_insumos` siguen SIN DELETE. Con
--     la conexion a Hacienda en camino, esos registros son append-only y no se
--     tocan.
--   * Las FK sin cascada desde `movimientos_stock`, `movimientos_insumos` y
--     `detalle_pedido` hacia `productos(id)` siguen impidiendo borrar cualquier
--     producto que tenga historial: Postgres lo rechaza con 23503.
--
-- O sea: solo se puede borrar un producto que nunca se uso. La app ademas lo
-- chequea antes y lo explica ("tiene 268 ventas registradas... desmarca
-- Mostrar en caja para sacarlo de la pantalla sin perder esos datos"), para que
-- el dueño no se encuentre con un error criptico de la base.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.
--
-- OJO AL PASAR A PRODUCCION: esta migracion hay que repetirla alla. Si no, el
-- boton Eliminar va a "funcionar" en la tablet y no borrar nada en la nube.

DROP POLICY IF EXISTS productos_delete ON productos;
CREATE POLICY productos_delete
  ON productos FOR DELETE TO authenticated USING (true);

DROP POLICY IF EXISTS recetas_delete ON recetas;
CREATE POLICY recetas_delete
  ON recetas FOR DELETE TO authenticated USING (true);

-- El log de cambios de receta de un producto que ya no existe no le sirve a
-- nadie, y si quedara huerfano ensuciaria la vista de recetas.
DROP POLICY IF EXISTS historial_recetas_delete ON historial_recetas;
CREATE POLICY historial_recetas_delete
  ON historial_recetas FOR DELETE TO authenticated USING (true);

-- `stock_productos` es una tabla DERIVADA (la mantiene el trigger que suma
-- `movimientos_stock`). Su fila tiene que irse con el producto; si quedara,
-- el proximo calculo de stock encontraria una fila sin dueño.
DROP POLICY IF EXISTS stock_productos_delete ON stock_productos;
CREATE POLICY stock_productos_delete
  ON stock_productos FOR DELETE TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
