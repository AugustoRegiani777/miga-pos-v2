-- =========================================
-- Miga POS v2 — Schema Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- =========================================

-- Ventas (cabecera)
CREATE TABLE IF NOT EXISTS ventas (
  id          BIGSERIAL PRIMARY KEY,
  fecha       TEXT NOT NULL,
  hora        TEXT,
  total_centavos INTEGER NOT NULL DEFAULT 0,
  sale_mode   TEXT NOT NULL DEFAULT 'normal',
  anulada     BOOLEAN NOT NULL DEFAULT false,
  anulada_en  TIMESTAMPTZ,
  -- Si la venta viene de un pedido (Pedidos > marcar preparado), para que
  -- "modo consulta" muestre "Pedido: cliente" igual que el dispositivo que opera.
  origen         TEXT,
  pedido_id      BIGINT,
  cliente_nombre TEXT,
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- Detalle de venta (líneas)
CREATE TABLE IF NOT EXISTS detalle_venta (
  id                    BIGSERIAL PRIMARY KEY,
  venta_id              BIGINT NOT NULL,
  producto_id           TEXT,
  producto_nombre       TEXT,
  cantidad              INTEGER NOT NULL DEFAULT 1,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0,
  subtotal_centavos     INTEGER NOT NULL DEFAULT 0,
  fecha                 TEXT,
  creado_en             TIMESTAMPTZ DEFAULT NOW()
);

-- Insumos (ingredientes)
CREATE TABLE IF NOT EXISTS insumos (
  id                    TEXT PRIMARY KEY,
  nombre                TEXT NOT NULL,
  unidad                TEXT NOT NULL,
  unidad_compra         TEXT,
  factor_conversion     NUMERIC NOT NULL DEFAULT 1,
  stock_actual          NUMERIC NOT NULL DEFAULT 0,
  stock_minimo          NUMERIC NOT NULL DEFAULT 0,
  stock_critico         NUMERIC NOT NULL DEFAULT 0,
  necesita_calibracion  BOOLEAN DEFAULT false,
  ultima_calibracion    JSONB,
  activo                BOOLEAN DEFAULT true,
  creado_en             TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

-- Recetas (qué insumos usa cada producto)
CREATE TABLE IF NOT EXISTS recetas (
  id                    TEXT PRIMARY KEY,
  producto_id           TEXT NOT NULL,
  insumo_id             TEXT NOT NULL,
  cantidad_por_unidad   NUMERIC NOT NULL,
  es_estimado           BOOLEAN DEFAULT false,
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos de insumos (cada descuento por venta o ajuste)
CREATE TABLE IF NOT EXISTS movimientos_insumos (
  id              BIGSERIAL PRIMARY KEY,
  insumo_id       TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  cantidad        NUMERIC NOT NULL,
  stock_anterior  NUMERIC,
  stock_nuevo     NUMERIC,
  venta_id_local  INTEGER,
  fecha           TEXT,
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);

-- Historial de calibraciones (datos del modelo ML)
CREATE TABLE IF NOT EXISTS historial_calibraciones (
  id                BIGSERIAL PRIMARY KEY,
  insumo_id         TEXT NOT NULL,
  fecha             TEXT,
  stock_antes       NUMERIC,
  stock_real        NUMERIC,
  sandwiches        INTEGER,
  consumo_esperado  NUMERIC,
  consumo_real      NUMERIC,
  factor_observado  NUMERIC,
  factor_clamped    NUMERIC,
  alpha_usado       NUMERIC,
  estimado_antes    NUMERIC,
  estimado_despues  NUMERIC,
  creado_en         TIMESTAMPTZ DEFAULT NOW()
);

-- Producción diaria
CREATE TABLE IF NOT EXISTS produccion_diaria (
  id          TEXT PRIMARY KEY,
  producto_id TEXT NOT NULL,
  fecha       TEXT NOT NULL,
  cantidad    INTEGER NOT NULL DEFAULT 0,
  creado_en   TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Stock actual de productos terminados — solo lo que cambia (el catalogo
-- nombre/precio/categoria ya es identico en todos los dispositivos via seed
-- local). Se usa para que "modo consulta" en otros dispositivos vea el mismo
-- stock que la tablet del local, sin duplicar el catalogo completo.
CREATE TABLE IF NOT EXISTS stock_productos (
  id             TEXT PRIMARY KEY,
  stock_actual   NUMERIC NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos de stock de productos
CREATE TABLE IF NOT EXISTS movimientos_stock (
  id              BIGSERIAL PRIMARY KEY,
  producto_id     TEXT,
  tipo            TEXT,
  cantidad        INTEGER,
  stock_anterior  INTEGER,
  stock_nuevo     INTEGER,
  motivo          TEXT,
  referencia      TEXT,
  fecha           TEXT,
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);

-- Pedidos (Instagram/WhatsApp) — fuente de verdad en Supabase, no en IDB local
CREATE TABLE IF NOT EXISTS pedidos (
  id                BIGSERIAL PRIMARY KEY,
  cliente_nombre    TEXT NOT NULL,
  fecha_hora_retiro TIMESTAMPTZ NOT NULL,
  pagado            BOOLEAN NOT NULL DEFAULT false,
  cortado_mitad     BOOLEAN NOT NULL DEFAULT false,
  aclaraciones      TEXT,
  total_centavos    INTEGER NOT NULL DEFAULT 0, -- editable a mano: puede diferir del catalogo por promos fuera del sistema
  estado            TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente' | 'listo' | 'entregado'
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listo_en          TIMESTAMPTZ,
  entregado_en      TIMESTAMPTZ
);

-- Detalle de pedido (líneas)
CREATE TABLE IF NOT EXISTS detalle_pedido (
  id                       BIGSERIAL PRIMARY KEY,
  pedido_id                BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id              TEXT NOT NULL,
  producto_nombre          TEXT NOT NULL,
  cantidad                 INTEGER NOT NULL,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0
);

-- =========================================
-- RLS con Auth (usuario/contraseña, Supabase Auth)
-- La app ahora exige login (3 cuentas: Augusto, Sharon, Guadalupe) antes de
-- llamar a Supabase. El anon key sin sesion no puede hacer NADA — ni leer ni
-- escribir ninguna tabla. Una vez logueado, cualquiera de las 3 cuentas puede
-- ver y operar todo (no hay roles distintos entre ellas).
-- =========================================
ALTER TABLE ventas               ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_venta        ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas              ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_insumos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_calibraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE produccion_diaria    ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock    ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_pedido       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_productos      ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado (las 3 cuentas) puede leer, insertar y
-- actualizar todas las tablas. DELETE solo existe en pedidos/detalle_pedido
-- (la app borra pedidos a proposito); el resto de las tablas no tiene policy
-- de DELETE porque la app nunca borra esas filas.
CREATE POLICY ventas_select ON ventas FOR SELECT TO authenticated USING (true);
CREATE POLICY ventas_insert ON ventas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ventas_update ON ventas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY detalle_venta_select ON detalle_venta FOR SELECT TO authenticated USING (true);
CREATE POLICY detalle_venta_insert ON detalle_venta FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY detalle_venta_update ON detalle_venta FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY insumos_select ON insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY insumos_insert ON insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY insumos_update ON insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY recetas_select ON recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY recetas_insert ON recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY recetas_update ON recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY movimientos_insumos_select ON movimientos_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_insumos_insert ON movimientos_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY movimientos_insumos_update ON movimientos_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY historial_calibraciones_select ON historial_calibraciones FOR SELECT TO authenticated USING (true);
CREATE POLICY historial_calibraciones_insert ON historial_calibraciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY historial_calibraciones_update ON historial_calibraciones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY produccion_diaria_select ON produccion_diaria FOR SELECT TO authenticated USING (true);
CREATE POLICY produccion_diaria_insert ON produccion_diaria FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY produccion_diaria_update ON produccion_diaria FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY movimientos_stock_select ON movimientos_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_stock_insert ON movimientos_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY movimientos_stock_update ON movimientos_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY pedidos_select ON pedidos FOR SELECT TO authenticated USING (true);
CREATE POLICY pedidos_insert ON pedidos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pedidos_update ON pedidos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pedidos_delete ON pedidos FOR DELETE TO authenticated USING (true);

-- detalle_pedido necesita DELETE tambien: al borrar un pedido, el ON DELETE
-- CASCADE de la FK borra sus lineas, y esa operacion en cascada igual pasa
-- por RLS (necesita su propia policy de DELETE para poder completarse).
CREATE POLICY detalle_pedido_select ON detalle_pedido FOR SELECT TO authenticated USING (true);
CREATE POLICY detalle_pedido_insert ON detalle_pedido FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY detalle_pedido_update ON detalle_pedido FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY detalle_pedido_delete ON detalle_pedido FOR DELETE TO authenticated USING (true);

CREATE POLICY stock_productos_select ON stock_productos FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_productos_insert ON stock_productos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_productos_update ON stock_productos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Índices útiles para queries del dashboard
CREATE INDEX IF NOT EXISTS idx_ventas_fecha               ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta_id     ON detalle_venta(venta_id);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_fecha        ON detalle_venta(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_insumo_id      ON movimientos_insumos(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_fecha          ON movimientos_insumos(fecha);
CREATE INDEX IF NOT EXISTS idx_histcal_insumo_id          ON historial_calibraciones(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_stock_fecha            ON movimientos_stock(fecha);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado             ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_retiro        ON pedidos(fecha_hora_retiro);
CREATE INDEX IF NOT EXISTS idx_detalle_pedido_pedido_id   ON detalle_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_produccion_diaria_fecha    ON produccion_diaria(fecha);
