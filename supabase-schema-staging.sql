-- =========================================
-- Miga POS v2 — Schema STAGING (branch arquitectura-productos-v2)
-- Ejecutar en: Supabase Dashboard → SQL Editor, en el proyecto NUEVO de
-- staging (nunca en el proyecto de produccion real).
--
-- Este archivo es la version rediseñada de la parte de PRODUCTOS (el ciclo
-- prioritario: produccion -> venta/baja/consumo/devolucion -> stock), a
-- partir de todo lo charlado el 23/09/2026. Insumos, recetas, proveedores y
-- pedidos quedan IGUAL que en supabase-schema.sql (produccion real) — esa
-- parte no se toco en este rediseño, sigue siendo secundaria por ahora.
-- =========================================

-- ============ CATALOGO (sin cambios) ============

CREATE TABLE categorias (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE productos (
  id              TEXT PRIMARY KEY,
  categoria_id    TEXT NOT NULL REFERENCES categorias(id),
  nombre          TEXT NOT NULL,
  precio_centavos INTEGER NOT NULL DEFAULT 0,
  sandwich_tipo   TEXT,
  umbral_bajo     INTEGER NOT NULL DEFAULT 0,
  controla_stock  BOOLEAN NOT NULL DEFAULT true,
  orden           INTEGER NOT NULL DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true
);

-- ============ VENTAS (rediseñado: ya no incluye "baja") ============

CREATE TABLE ventas (
  id             BIGSERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE NOT NULL,
  fecha          TEXT NOT NULL,
  hora           TEXT,
  total_centavos INTEGER NOT NULL DEFAULT 0,
  -- 'baja' ya NO es un sale_mode — una baja no es una venta, no genera fila
  -- aca (ver movimientos_stock.tipo = 'baja' mas abajo).
  sale_mode      TEXT NOT NULL DEFAULT 'normal' CHECK (sale_mode IN ('normal', 'togoo')),
  anulada        BOOLEAN NOT NULL DEFAULT false,
  anulada_en     TIMESTAMPTZ,
  origen         TEXT,
  pedido_id      BIGINT,
  cliente_nombre TEXT,
  creado_en      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX ventas_pedido_id_unique
  ON ventas (pedido_id)
  WHERE pedido_id IS NOT NULL;

CREATE TABLE detalle_venta (
  id                       BIGSERIAL PRIMARY KEY,
  uuid                     TEXT UNIQUE NOT NULL,
  venta_id                 BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id              TEXT,  -- sin FK a proposito: combo-N/togoo-fee son sinteticos
  producto_nombre          TEXT,
  cantidad                 INTEGER NOT NULL DEFAULT 1,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0,
  subtotal_centavos        INTEGER NOT NULL DEFAULT 0,
  fecha                    TEXT,
  opcion_nombre            TEXT,
  creado_en                TIMESTAMPTZ DEFAULT NOW()
);

-- ============ EL LEDGER DE PRODUCTOS — lo nuevo de esta semana ============

CREATE TABLE movimientos_stock (
  id             BIGSERIAL PRIMARY KEY,
  uuid           TEXT UNIQUE NOT NULL,
  producto_id    TEXT NOT NULL REFERENCES productos(id),
  tipo           TEXT NOT NULL CHECK (tipo IN (
    'produccion',        -- entra
    'venta',              -- sale, ingreso real
    'baja',                -- sale, desperdicio — YA NO es una venta
    'consumo',              -- sale, interno — YA NO es una venta
    'devolucion',            -- entra, deshace una venta
    'error_produccion'        -- correccion fuerte del mismo dia, unico ajuste que existe
    -- 'ajuste_stock' / 'ajuste_manual' (recuento generico): NO EXISTE MAS
  )),
  cantidad       INTEGER NOT NULL,
  stock_anterior INTEGER,  -- informativo/auditoria, igual que en movimientos_insumos
  stock_nuevo    INTEGER,  -- informativo/auditoria — el trigger de abajo NO confia en esto
  motivo         TEXT,
  venta_id       BIGINT REFERENCES ventas(id),  -- solo tiene sentido para tipo IN ('venta','devolucion')
  fecha          TEXT NOT NULL,
  creado_en      TIMESTAMPTZ DEFAULT NOW()
);

-- Derivada, 100% por trigger, SUMA DE DELTAS (no "snapshot con guarda de
-- fecha" como la version vieja de produccion) — mismo patron ya probado en
-- stock_insumos esta semana, mas seguro bajo escritores concurrentes.
CREATE TABLE stock_productos (
  id             TEXT PRIMARY KEY REFERENCES productos(id),
  stock_actual   NUMERIC NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION stock_productos_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE stock_productos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.producto_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad
       AND NEW.producto_id IS NOT DISTINCT FROM OLD.producto_id THEN
      RETURN NEW;
    END IF;
    UPDATE stock_productos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.producto_id;
  END IF;

  INSERT INTO stock_productos (id, stock_actual, actualizado_en)
  VALUES (NEW.producto_id, NEW.cantidad, NOW())
  ON CONFLICT (id) DO UPDATE
    SET stock_actual = stock_productos.stock_actual + NEW.cantidad,
        actualizado_en = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_productos_desde_movimiento
  AFTER INSERT OR UPDATE OR DELETE ON movimientos_stock
  FOR EACH ROW
  EXECUTE FUNCTION stock_productos_desde_movimiento();

-- produccion_diaria ya NO es una tabla — es una vista, imposible de
-- desalinear del ledger porque no guarda nada aparte, solo lo resume.
CREATE VIEW produccion_diaria AS
SELECT
  fecha || ':' || producto_id AS id,
  producto_id,
  fecha,
  SUM(cantidad) AS cantidad
FROM movimientos_stock
WHERE tipo = 'produccion'
GROUP BY fecha, producto_id;

-- ============ INSUMOS Y RECETAS (sin cambios respecto a produccion) ============

CREATE TABLE insumos (
  id                    TEXT PRIMARY KEY,
  nombre                TEXT NOT NULL,
  unidad                TEXT NOT NULL,
  unidad_compra         TEXT,
  factor_conversion     NUMERIC NOT NULL DEFAULT 1,
  stock_minimo          NUMERIC NOT NULL DEFAULT 0,
  stock_critico         NUMERIC NOT NULL DEFAULT 0,
  necesita_calibracion  BOOLEAN DEFAULT false,
  ultima_calibracion    JSONB,
  activo                BOOLEAN DEFAULT true,
  creado_en             TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE recetas (
  id                    TEXT PRIMARY KEY,
  producto_id           TEXT NOT NULL REFERENCES productos(id),
  insumo_id             TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  cantidad_por_unidad   NUMERIC NOT NULL,
  es_estimado           BOOLEAN DEFAULT false,
  variantes_cantidad    JSONB,
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE movimientos_insumos (
  id              BIGSERIAL PRIMARY KEY,
  uuid            TEXT UNIQUE,
  insumo_id       TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('compra', 'desperdicio', 'no_recibido', 'error_conteo', 'produccion', 'venta', 'devolucion', 'calibracion')),
  cantidad        NUMERIC NOT NULL,
  stock_anterior  NUMERIC,
  stock_nuevo     NUMERIC,
  producto_id     TEXT REFERENCES productos(id),
  venta_id_local  INTEGER,
  fecha           TEXT,
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_insumos (
  id             TEXT PRIMARY KEY REFERENCES insumos(id) ON DELETE CASCADE,
  stock_actual   NUMERIC NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION stock_insumos_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE stock_insumos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.insumo_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.cantidad IS NOT DISTINCT FROM OLD.cantidad
       AND NEW.insumo_id IS NOT DISTINCT FROM OLD.insumo_id THEN
      RETURN NEW;
    END IF;
    UPDATE stock_insumos
      SET stock_actual = stock_actual - OLD.cantidad, actualizado_en = NOW()
      WHERE id = OLD.insumo_id;
  END IF;

  INSERT INTO stock_insumos (id, stock_actual, actualizado_en)
  VALUES (NEW.insumo_id, NEW.cantidad, NOW())
  ON CONFLICT (id) DO UPDATE
    SET stock_actual = stock_insumos.stock_actual + NEW.cantidad,
        actualizado_en = NOW();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stock_insumos_desde_movimiento
  AFTER INSERT OR UPDATE OR DELETE ON movimientos_insumos
  FOR EACH ROW
  EXECUTE FUNCTION stock_insumos_desde_movimiento();

CREATE TABLE historial_calibraciones (
  id                BIGSERIAL PRIMARY KEY,
  uuid              TEXT UNIQUE,
  insumo_id         TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
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

CREATE TABLE historial_recetas (
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

-- ============ PROVEEDORES (sin cambios) ============

CREATE TABLE proveedores (
  id             TEXT PRIMARY KEY,
  nombre         TEXT NOT NULL,
  tel            TEXT,
  email          TEXT,
  notas          TEXT,
  dias_ciclo     INTEGER,
  activo         BOOLEAN NOT NULL DEFAULT true,
  creado_en      TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE proveedor_insumos (
  id                       TEXT PRIMARY KEY,
  proveedor_id             TEXT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
  insumo_id                TEXT REFERENCES insumos(id) ON DELETE CASCADE,
  nombre_producto          TEXT,
  unidad_compra            TEXT,
  cantidad_por_unidad      NUMERIC,
  precio_unitario_centavos INTEGER,
  activo                   BOOLEAN NOT NULL DEFAULT true,
  creado_en                TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en           TIMESTAMPTZ DEFAULT NOW()
);

-- ============ CONFIG COMPARTIDA (sin cambios) ============

CREATE TABLE configuracion_compartida (
  id             TEXT PRIMARY KEY,
  valor          JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- ============ PEDIDOS (sin cambios) ============

CREATE TABLE pedidos (
  id                BIGSERIAL PRIMARY KEY,
  cliente_nombre    TEXT NOT NULL,
  fecha_hora_retiro TIMESTAMPTZ NOT NULL,
  pagado            BOOLEAN NOT NULL DEFAULT false,
  cortado_mitad     BOOLEAN NOT NULL DEFAULT false,
  aclaraciones      TEXT,
  total_centavos    INTEGER NOT NULL DEFAULT 0,
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'entregado')),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listo_en          TIMESTAMPTZ,
  entregado_en      TIMESTAMPTZ
);

CREATE TABLE detalle_pedido (
  id                       BIGSERIAL PRIMARY KEY,
  pedido_id                BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id              TEXT NOT NULL REFERENCES productos(id),
  producto_nombre          TEXT NOT NULL,
  cantidad                 INTEGER NOT NULL,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0
);

-- =========================================
-- RLS — igual de permisiva que produccion (single-tenant, sin roles)
-- =========================================
ALTER TABLE categorias              ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_venta           ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_productos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_insumos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_insumos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_calibraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_recetas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores             ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedor_insumos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_compartida ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_pedido          ENABLE ROW LEVEL SECURITY;

CREATE POLICY categorias_select ON categorias FOR SELECT TO authenticated USING (true);
CREATE POLICY categorias_insert ON categorias FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY categorias_update ON categorias FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY productos_select ON productos FOR SELECT TO authenticated USING (true);
CREATE POLICY productos_insert ON productos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY productos_update ON productos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY ventas_select ON ventas FOR SELECT TO authenticated USING (true);
CREATE POLICY ventas_insert ON ventas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY ventas_update ON ventas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY detalle_venta_select ON detalle_venta FOR SELECT TO authenticated USING (true);
CREATE POLICY detalle_venta_insert ON detalle_venta FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY detalle_venta_update ON detalle_venta FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY movimientos_stock_select ON movimientos_stock FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_stock_insert ON movimientos_stock FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY movimientos_stock_update ON movimientos_stock FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY movimientos_stock_delete ON movimientos_stock FOR DELETE TO authenticated USING (true);

CREATE POLICY stock_productos_select ON stock_productos FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_productos_insert ON stock_productos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_productos_update ON stock_productos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY insumos_select ON insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY insumos_insert ON insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY insumos_update ON insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY recetas_select ON recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY recetas_insert ON recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY recetas_update ON recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY movimientos_insumos_select ON movimientos_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_insumos_insert ON movimientos_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY movimientos_insumos_update ON movimientos_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY stock_insumos_select ON stock_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_insumos_insert ON stock_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_insumos_update ON stock_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY historial_calibraciones_select ON historial_calibraciones FOR SELECT TO authenticated USING (true);
CREATE POLICY historial_calibraciones_insert ON historial_calibraciones FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY historial_calibraciones_update ON historial_calibraciones FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY historial_recetas_select ON historial_recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY historial_recetas_insert ON historial_recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY historial_recetas_update ON historial_recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY proveedores_select ON proveedores FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedores_insert ON proveedores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY proveedores_update ON proveedores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY proveedor_insumos_select ON proveedor_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedor_insumos_insert ON proveedor_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY proveedor_insumos_update ON proveedor_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY configuracion_compartida_select ON configuracion_compartida FOR SELECT TO authenticated USING (true);
CREATE POLICY configuracion_compartida_insert ON configuracion_compartida FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY configuracion_compartida_update ON configuracion_compartida FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY pedidos_select ON pedidos FOR SELECT TO authenticated USING (true);
CREATE POLICY pedidos_insert ON pedidos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY pedidos_update ON pedidos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY pedidos_delete ON pedidos FOR DELETE TO authenticated USING (true);

CREATE POLICY detalle_pedido_select ON detalle_pedido FOR SELECT TO authenticated USING (true);
CREATE POLICY detalle_pedido_insert ON detalle_pedido FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY detalle_pedido_update ON detalle_pedido FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY detalle_pedido_delete ON detalle_pedido FOR DELETE TO authenticated USING (true);

-- =========================================
-- Indices
-- =========================================
CREATE INDEX idx_productos_categoria_id      ON productos(categoria_id);
CREATE INDEX idx_ventas_fecha                ON ventas(fecha);
CREATE INDEX idx_detalle_venta_venta_id      ON detalle_venta(venta_id);
CREATE INDEX idx_detalle_venta_fecha         ON detalle_venta(fecha);
CREATE INDEX idx_mov_stock_fecha_producto    ON movimientos_stock(fecha, producto_id);
CREATE INDEX idx_mov_stock_producto_id       ON movimientos_stock(producto_id);
CREATE INDEX idx_recetas_producto_id         ON recetas(producto_id);
CREATE INDEX idx_mov_insumos_insumo_id       ON movimientos_insumos(insumo_id);
CREATE INDEX idx_mov_insumos_fecha           ON movimientos_insumos(fecha);
CREATE INDEX idx_histcal_insumo_id           ON historial_calibraciones(insumo_id);
CREATE INDEX idx_histrecetas_receta_id       ON historial_recetas(receta_id);
CREATE INDEX idx_pedidos_estado              ON pedidos(estado);
CREATE INDEX idx_pedidos_fecha_retiro        ON pedidos(fecha_hora_retiro);
CREATE INDEX idx_detalle_pedido_pedido_id    ON detalle_pedido(pedido_id);
CREATE INDEX idx_prov_insumos_proveedor_id   ON proveedor_insumos(proveedor_id);
CREATE INDEX idx_prov_insumos_insumo_id      ON proveedor_insumos(insumo_id);
