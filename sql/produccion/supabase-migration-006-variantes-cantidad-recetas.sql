-- Permite que cada linea de receta guarde cantidades distintas por opcion de
-- variante (ej. "Avena": 220ml en vez de los 210ml base) — ver aprovisionamiento.js
-- resolverLineaEfectiva(). Sin esta columna, pushRecetasSnapshot fallaria al
-- intentar mandar un campo que Supabase no reconoce.
ALTER TABLE recetas ADD COLUMN IF NOT EXISTS variantes_cantidad JSONB;
