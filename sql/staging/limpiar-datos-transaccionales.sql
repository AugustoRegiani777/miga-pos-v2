-- SOLO STAGING (yfveeikzckvqlndmhwut). NUNCA correr en produccion.
-- Borra ventas, detalles y movimientos para volver a cargar el dataset de
-- prueba desde cero. No toca catalogo, recetas, insumos ni proveedores.
-- Los triggers recalculan stock_productos / stock_insumos a 0 solos.

DELETE FROM movimientos_stock;
DELETE FROM movimientos_insumos;
DELETE FROM detalle_venta;
DELETE FROM ventas;
DELETE FROM historial_calibraciones;
DELETE FROM historial_recetas;
DELETE FROM configuracion_compartida;

-- Verificacion: todo en 0
SELECT 'ventas' AS tabla, count(*) FROM ventas
UNION ALL SELECT 'movimientos_stock', count(*) FROM movimientos_stock
UNION ALL SELECT 'movimientos_insumos', count(*) FROM movimientos_insumos
UNION ALL SELECT 'stock_productos != 0', count(*) FROM stock_productos WHERE stock_actual <> 0
UNION ALL SELECT 'stock_insumos != 0', count(*) FROM stock_insumos WHERE stock_actual <> 0;
