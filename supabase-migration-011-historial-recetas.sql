-- =========================================
-- Miga POS v2 — Migracion 011: historial_recetas ahora se sincroniza
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- Cada vez que se corrige a mano una cantidad de receta (Gestion > Recetas,
-- ver actualizarReceta en aprovisionamiento.js) queda un registro de "antes
-- vs despues y por que" — hasta ahora vivia SOLO en la tablet, sin llegar
-- nunca a Supabase. Si la tablet se rompe, se pierde ese historial para
-- siempre (el valor ACTUAL de la receta si esta a salvo, via recetas, pero
-- el "como se llego hasta ahi" no).
CREATE TABLE IF NOT EXISTS historial_recetas (
  id             BIGSERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE,
  receta_id      TEXT NOT NULL REFERENCES recetas(id) ON DELETE CASCADE,
  producto_id    TEXT REFERENCES productos(id),
  insumo_id      TEXT REFERENCES insumos(id),
  valor_anterior NUMERIC,
  valor_nuevo    NUMERIC,
  motivo         TEXT,
  creado_en      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE historial_recetas ENABLE ROW LEVEL SECURITY;
CREATE POLICY historial_recetas_select ON historial_recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY historial_recetas_insert ON historial_recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY historial_recetas_update ON historial_recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_histrecetas_receta_id ON historial_recetas(receta_id);
