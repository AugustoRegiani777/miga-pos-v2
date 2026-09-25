-- =========================================
-- Miga POS v2 — Migracion 005: opcion_nombre en detalle_venta
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- Hasta ahora el selector "¿Con que leche?" en caja solo cambiaba el texto
-- del ticket (producto_nombre) — el insumo que se descontaba en el codigo
-- (recien conectado con esta misma tanda de cambios) era siempre el de la
-- receta por defecto, sin importar la leche elegida. Para poder descontar y,
-- si se deshace la venta, devolver exactamente la leche que se vendio, hace
-- falta guardar la opcion elegida en su propio campo — no alcanza con
-- extraerla del texto de producto_nombre.
ALTER TABLE detalle_venta ADD COLUMN IF NOT EXISTS opcion_nombre TEXT;
