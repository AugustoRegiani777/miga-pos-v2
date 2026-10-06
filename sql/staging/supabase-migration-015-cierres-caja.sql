-- Migracion 015: cierre de caja (arqueo de efectivo + tarjeta de Postnet)
--
-- Cada cierre es un registro que NO se edita ni se borra: si hay que corregir
-- el cierre de un dia, se guarda uno nuevo y el mas reciente es el vigente
-- (el anterior queda en el historial). Por eso solo hay politicas de SELECT e
-- INSERT: sin UPDATE ni DELETE para los usuarios de la app. Es la misma
-- regla de "registros financieros append-only" que necesita la facturacion
-- fiscal futura.
--
-- Los importes guardan una FOTO de lo que dijo el sistema al momento de
-- cerrar (ventas, TGTG, esperado), asi el cierre sigue siendo auditable aunque
-- despues cambie algo del dia.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

CREATE TABLE IF NOT EXISTS cierres_caja (
  id                          BIGSERIAL PRIMARY KEY,
  uuid                        TEXT UNIQUE NOT NULL,
  fecha                       TEXT NOT NULL,                 -- dia que se cierra (YYYY-MM-DD)

  -- lo que dijo el sistema (foto al cerrar)
  ventas_total_centavos       INTEGER NOT NULL,              -- todas las ventas no anuladas, incluidos paquetes TGTG
  tickets                     INTEGER NOT NULL,
  tgtg_centavos               INTEGER NOT NULL DEFAULT 0,    -- parte de las ventas que son paquetes Too Good To Go
  tgtg_en_cajon               BOOLEAN NOT NULL DEFAULT false,-- true si el TGTG se cobro en el local (entra al cajon)

  -- lo que dijo la realidad
  fondo_inicial_centavos      INTEGER NOT NULL CHECK (fondo_inicial_centavos >= 0),
  tarjeta_centavos            INTEGER NOT NULL CHECK (tarjeta_centavos >= 0),   -- total del cierre de Postnet
  tarjeta_origen              TEXT NOT NULL DEFAULT 'manual',                   -- 'manual' hoy; 'postnet' cuando se integre
  plataformas_centavos        INTEGER NOT NULL DEFAULT 0 CHECK (plataformas_centavos >= 0), -- Glovo etc: cobra la plataforma
  retiros_centavos            INTEGER NOT NULL DEFAULT 0 CHECK (retiros_centavos >= 0),
  retiros_nota                TEXT,
  contado_centavos            INTEGER NOT NULL CHECK (contado_centavos >= 0),   -- efectivo contado al cerrar
  fondo_manana_centavos       INTEGER CHECK (fondo_manana_centavos >= 0),       -- efectivo que se deja para manana

  -- resultado (calculado por la app, guardado para auditar)
  esperado_efectivo_centavos  INTEGER NOT NULL,
  diferencia_centavos         INTEGER NOT NULL,              -- contado - esperado (negativo = falta plata)

  nota                        TEXT,
  creado_en                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cierres_caja_fecha ON cierres_caja (fecha, creado_en DESC);

ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cierres_caja_select ON cierres_caja;
DROP POLICY IF EXISTS cierres_caja_insert ON cierres_caja;
CREATE POLICY cierres_caja_select ON cierres_caja FOR SELECT TO authenticated USING (true);
CREATE POLICY cierres_caja_insert ON cierres_caja FOR INSERT TO authenticated WITH CHECK (true);
-- sin politicas de UPDATE ni DELETE: append-only

NOTIFY pgrst, 'reload schema';
