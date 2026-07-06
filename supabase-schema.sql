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

-- =========================================
-- Deshabilitar RLS para uso sin auth
-- (habilitar y agregar policies cuando se implemente auth del dueño)
-- =========================================
ALTER TABLE ventas               DISABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_venta        DISABLE ROW LEVEL SECURITY;
ALTER TABLE insumos              DISABLE ROW LEVEL SECURITY;
ALTER TABLE recetas              DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_insumos  DISABLE ROW LEVEL SECURITY;
ALTER TABLE historial_calibraciones DISABLE ROW LEVEL SECURITY;
ALTER TABLE produccion_diaria    DISABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock    DISABLE ROW LEVEL SECURITY;

-- Índices útiles para queries del dashboard
CREATE INDEX IF NOT EXISTS idx_ventas_fecha               ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta_id     ON detalle_venta(venta_id);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_fecha        ON detalle_venta(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_insumo_id      ON movimientos_insumos(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_fecha          ON movimientos_insumos(fecha);
CREATE INDEX IF NOT EXISTS idx_histcal_insumo_id          ON historial_calibraciones(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_stock_fecha            ON movimientos_stock(fecha);
