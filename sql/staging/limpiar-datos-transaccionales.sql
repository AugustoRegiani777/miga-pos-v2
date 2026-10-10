-- SOLO STAGING (yfveeikzckvqlndmhwut). NUNCA correr en produccion.
--
-- Borra el movimiento: ventas, produccion, caja y el ledger de stock. Deja
-- intacto el catalogo (productos, categorias, insumos, recetas, proveedores,
-- proveedor_insumos) y la configuracion compartida.
--
-- OJO con configuracion_compartida: la version anterior de este archivo la
-- vaciaba, y ahi viven los grupos de variante ("Tipo de leche", "Bebida") y
-- los precios de los combos. Eso es catalogo, no movimiento: borrarlo dejaba
-- la caja sin preguntar que leche y los combos sin precio. No se toca.
--
-- El stock no se borra a mano: stock_productos y stock_insumos los derivan los
-- triggers del ledger (migraciones 004 y 012), asi que al vaciar los
-- movimientos quedan en 0 solos. Si se borraran a mano, el trigger los
-- volveria a escribir y quedarian desalineados.

BEGIN;

-- Caja del dia: los movimientos antes que su sesion (clave foranea).
DELETE FROM movimientos_caja;
DELETE FROM cierres_caja;
DELETE FROM sesiones_caja;

-- Pedidos: el detalle antes que la cabecera.
DELETE FROM detalle_pedido;
DELETE FROM pedidos;

-- Ventas: el detalle antes que la cabecera.
DELETE FROM detalle_venta;
DELETE FROM ventas;

-- Ledger. produccion_diaria NO se borra: es una VISTA sobre movimientos_stock
-- (tipo = 'produccion'), no una tabla. Un DELETE ahi falla con 55000 y tira
-- abajo la transaccion entera. Se vacia sola al vaciar los movimientos.
DELETE FROM movimientos_stock;
DELETE FROM movimientos_insumos;

-- Historiales de aprendizaje del modelo.
DELETE FROM historial_calibraciones;
DELETE FROM historial_recetas;

COMMIT;

-- Verificacion: todo en 0, y el catalogo en pie.
SELECT 'ventas'                AS tabla, count(*) AS filas FROM ventas
UNION ALL SELECT 'detalle_venta',          count(*) FROM detalle_venta
UNION ALL SELECT 'movimientos_stock',      count(*) FROM movimientos_stock
UNION ALL SELECT 'movimientos_insumos',    count(*) FROM movimientos_insumos
UNION ALL SELECT 'produccion_diaria (vista)', count(*) FROM produccion_diaria
UNION ALL SELECT 'sesiones_caja',          count(*) FROM sesiones_caja
UNION ALL SELECT 'pedidos',                count(*) FROM pedidos
UNION ALL SELECT 'stock_productos != 0',   count(*) FROM stock_productos WHERE stock_actual <> 0
UNION ALL SELECT 'stock_insumos != 0',     count(*) FROM stock_insumos  WHERE stock_actual <> 0
UNION ALL SELECT '--- queda en pie ---',   NULL
UNION ALL SELECT 'productos',              count(*) FROM productos
UNION ALL SELECT 'insumos',                count(*) FROM insumos
UNION ALL SELECT 'recetas',                count(*) FROM recetas
UNION ALL SELECT 'proveedores',            count(*) FROM proveedores
UNION ALL SELECT 'proveedor_insumos',      count(*) FROM proveedor_insumos
UNION ALL SELECT 'configuracion_compartida', count(*) FROM configuracion_compartida;
