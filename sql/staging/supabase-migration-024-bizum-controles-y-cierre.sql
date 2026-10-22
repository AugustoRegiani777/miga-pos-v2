-- Migracion 024: Bizum en pedidos, controles de caja durante el dia, y foto del cierre en dos columnas.
--
-- QUE PIDIO EL DUEÑO (22/10/2026)
--   * En PEDIDOS se elige el medio de pago: efectivo, tarjeta o Bizum. Efectivo y tarjeta se cobran en el
--     local y entran a la caja; Bizum NO entra a la caja: se registra como "otros ingresos", igual que
--     Too Good To Go y Glovo.
--   * En la caja se puede CONTAR el efectivo en cualquier momento del dia ("a las 12 cuento y dejo marcado
--     que a esa hora habia tanto"), con el nombre de quien lo hizo. Es un arqueo que NO cierra el turno.
--   * El cierre muestra dos columnas (lo REAL contado vs lo que dice el SISTEMA). Para poder pulir errores
--     despues, el cierre guarda tambien el lado "sistema" de la tarjeta y lo cobrado por Bizum.
--
-- IMPORTANTE: correr ESTO ANTES de publicar el codigo que lo usa. Si la app manda 'bizum', un arqueo
-- 'control' o una columna que la base todavia no tiene, el push falla (23514 / 42703), la operacion se
-- traba en la cola y una cola trabada apaga la reconciliacion de stock (es lo que paso el 05/10).
--
-- Idempotente: se puede correr mas de una vez sin efecto extra. No borra ni modifica ninguna fila.

-- 1) Ventas: forma de pago 'bizum' (solo la usan los pedidos).
ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_forma_pago_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_forma_pago_check CHECK (forma_pago IN ('efectivo', 'tarjeta', 'glovo', 'bizum'));

-- 2) Pedidos: con que se paga. Por defecto efectivo (los pedidos que ya existen quedan como estaban).
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS forma_pago TEXT NOT NULL DEFAULT 'efectivo';
ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_forma_pago_check;
ALTER TABLE pedidos ADD CONSTRAINT pedidos_forma_pago_check CHECK (forma_pago IN ('efectivo', 'tarjeta', 'bizum'));

-- 3) Arqueos: un control del efectivo a media jornada. NO cierra el turno ni el dia.
ALTER TABLE arqueos_caja DROP CONSTRAINT IF EXISTS arqueos_caja_tipo_check;
ALTER TABLE arqueos_caja ADD CONSTRAINT arqueos_caja_tipo_check CHECK (tipo IN ('relevo', 'final', 'control'));

-- 4) Cierres: el lado "sistema" de la tarjeta y lo cobrado por Bizum, tal cual estaban al cerrar.
--    Nullable / con default a proposito: una pestaña vieja que reintente un cierre sin estas columnas no
--    debe fallar nunca.
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS tarjeta_sistema_centavos INTEGER;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS bizum_centavos INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN pedidos.forma_pago IS 'efectivo | tarjeta | bizum. Efectivo y tarjeta se cobran en el local (caja); bizum no entra a la caja: es un ingreso aparte.';
COMMENT ON COLUMN cierres_caja.tarjeta_sistema_centavos IS 'Tarjeta que decia el sistema al cerrar (ventas.forma_pago), para comparar contra tarjeta_centavos (cierre real de Postnet).';
COMMENT ON COLUMN cierres_caja.bizum_centavos IS 'Cobrado por Bizum (pedidos) el dia del cierre. No entra a la caja.';

NOTIFY pgrst, 'reload schema';
