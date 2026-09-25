-- La migracion 007 creo configuracion_compartida pero se olvido de habilitar
-- RLS y sus policies (a diferencia de TODAS las demas tablas del proyecto,
-- que ya las tienen desde sql/produccion/supabase-schema.sql). Sin esto, cualquier intento
-- de guardar los grupos de variante (Gestion > Variantes) falla siempre con
-- "new row violates row-level security policy for table configuracion_compartida".
ALTER TABLE configuracion_compartida ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuracion_compartida_select ON configuracion_compartida FOR SELECT TO authenticated USING (true);
CREATE POLICY configuracion_compartida_insert ON configuracion_compartida FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY configuracion_compartida_update ON configuracion_compartida FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
