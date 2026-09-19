-- Tabla generica para config de baja frecuencia que debe verse igual en
-- todos los dispositivos (celu y tablet) — hoy la usa "variantes_grupos"
-- (Gestion > Variantes), que antes no viajaba a Supabase para nada: crear un
-- grupo desde el celu no aparecia nunca en la tablet, ni al tocar "Actualizar
-- catalogo". Ver pushVariantesGrupos/fetchVariantesGrupos en supabase.js y
-- pullVariantesGruposDesdeNube en variantes.js.
CREATE TABLE IF NOT EXISTS configuracion_compartida (
  id             TEXT PRIMARY KEY,
  valor          JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);
