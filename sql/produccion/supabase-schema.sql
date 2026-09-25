-- =========================================
-- Miga POS v2 — Schema Supabase
-- Ejecutar en: Supabase Dashboard → SQL Editor
--
-- Este archivo es el reflejo COMPLETO y ACTUAL de la base — equivale a
-- correr, en orden, la migracion 002 hasta la 013 sobre la version original.
-- Para una base nueva desde cero, corriendo SOLO este archivo alcanza (no
-- hace falta correr las migraciones numeradas despues). Las migraciones
-- numeradas quedan igual en el repo como registro historico de como se
-- llego hasta aca — no se vuelven a correr sobre una base que ya uso este
-- archivo consolidado.
-- =========================================

-- Categorias y productos — espejo de src/modules/seed.js
-- (initialCategories/initialProducts). No se sincronizan fila por fila como
-- el resto: se suben enteras cada vez que el catalogo cambia en el codigo
-- (ver pushCatalogoSnapshot en supabase.js).
CREATE TABLE IF NOT EXISTS categorias (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productos (
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

-- Ventas (cabecera)
-- uuid: identidad compartida con la fila local en IDB, generada en la tablet
-- al crear la venta (crypto.randomUUID()). El id autoincremental de Supabase
-- y el id autoincremental local NO son el mismo numero — son dos secuencias
-- independientes — por eso el uuid es lo que hay que usar para referenciar
-- "esta venta puntual" desde otro dispositivo (ver updateVentaAnulada en
-- supabase.js). Tambien sirve como conflict target de upsert, asi que
-- reintentar un push que en realidad ya se habia guardado no duplica la fila.
CREATE TABLE IF NOT EXISTS ventas (
  id          BIGSERIAL PRIMARY KEY,
  uuid        TEXT UNIQUE,
  fecha       TEXT NOT NULL,
  hora        TEXT,
  total_centavos INTEGER NOT NULL DEFAULT 0,
  sale_mode   TEXT NOT NULL DEFAULT 'normal' CHECK (sale_mode IN ('normal', 'togoo', 'baja')),
  anulada     BOOLEAN NOT NULL DEFAULT false,
  anulada_en  TIMESTAMPTZ,
  -- Si la venta viene de un pedido (Pedidos > marcar preparado), para que
  -- "modo consulta" muestre "Pedido: cliente" igual que el dispositivo que opera.
  -- NO lleva FK a proposito: los pedidos se borran despues de cumplirse (ver
  -- deletePedido en supabase.js), asi que una venta historica que vino de un
  -- pedido ya borrado es esperable, no un error de datos.
  origen         TEXT,
  pedido_id      BIGINT,
  cliente_nombre TEXT,
  creado_en   TIMESTAMPTZ DEFAULT NOW()
);

-- Un pedido solo se marca "listo" una vez (patchEstadoPedido exige el estado
-- anterior "pendiente"), asi que pedido_id nunca deberia repetirse entre
-- ventas. Este indice hace la regla imposible de violar a nivel de base, no
-- solo improbable a nivel de app (incidente real 20/07/2026: wifi inestable
-- + reintentos casi simultaneos generaron 259 ventas duplicadas antes de
-- este indice — ver seccion 8.7 de CLAUDE.md).
CREATE UNIQUE INDEX IF NOT EXISTS ventas_pedido_id_unique
  ON ventas (pedido_id)
  WHERE pedido_id IS NOT NULL;

-- Detalle de venta (líneas)
-- producto_id NO lleva FK a proposito: conviven productos reales con
-- marcadores sinteticos (combo-6, combo-12, togoo-fee, ajuste-pedido-N) que
-- nunca van a existir en `productos`. El dashboard hace LEFT JOIN contra
-- productos y trata lo que no matchea como lo que es.
CREATE TABLE IF NOT EXISTS detalle_venta (
  id                    BIGSERIAL PRIMARY KEY,
  uuid                  TEXT UNIQUE,
  venta_id              BIGINT NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id           TEXT,
  producto_nombre       TEXT,
  cantidad              INTEGER NOT NULL DEFAULT 1,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0,
  subtotal_centavos     INTEGER NOT NULL DEFAULT 0,
  fecha                 TEXT,
  -- Que variante se eligio en caja (ej. "Avena" en "¿Con que leche?") — para
  -- poder descontar y, si se deshace la venta, devolver exactamente ese
  -- insumo puntual, no siempre el default de la receta.
  opcion_nombre         TEXT,
  creado_en             TIMESTAMPTZ DEFAULT NOW()
);

-- Insumos (ingredientes)
-- stock_actual NO vive aca — ver stock_insumos mas abajo (definicion y stock
-- en vivo separados a proposito, migracion 012/013: 8 lugares del codigo
-- empujan esta definicion completa cada vez que cambia cualquier cosa del
-- insumo, y si el stock viviera en la misma fila, cualquiera de esos pushes
-- pisaria sin darse cuenta el stock real con un numero viejo de otro
-- dispositivo — incidente real confirmado 22/09/2026, caso "atun".
CREATE TABLE IF NOT EXISTS insumos (
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

-- Recetas (qué insumos usa cada producto)
CREATE TABLE IF NOT EXISTS recetas (
  id                    TEXT PRIMARY KEY,
  producto_id           TEXT NOT NULL REFERENCES productos(id),
  insumo_id             TEXT NOT NULL REFERENCES insumos(id) ON DELETE CASCADE,
  cantidad_por_unidad   NUMERIC NOT NULL,
  es_estimado           BOOLEAN DEFAULT false,
  -- Cantidad distinta por opcion de variante (ej. {"Avena": 220}) cuando
  -- rinde diferente de la cantidad base de arriba — ver
  -- resolverLineaEfectiva en aprovisionamiento.js.
  variantes_cantidad    JSONB,
  actualizado_en        TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos de insumos (cada descuento por venta o ajuste)
-- producto_id: el consumo de insumos se descuenta en produccion o en venta
-- de productos sin control de stock (cafe/bebidas) — se guarda para poder
-- filtrar "cuanto de este insumo se fue en este producto". venta_id_local
-- se deja sin FK (no tiene sentido cross-dispositivo, es el id autoincrement
-- LOCAL de esa tablet, no el id de Supabase).
CREATE TABLE IF NOT EXISTS movimientos_insumos (
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

-- Historial de calibraciones (datos del modelo ML)
CREATE TABLE IF NOT EXISTS historial_calibraciones (
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

-- Historial de cambios manuales a recetas (Gestion > Recetas) — "antes vs
-- despues y por que" cada vez que se corrige a mano una cantidad.
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

-- Proveedores
CREATE TABLE IF NOT EXISTS proveedores (
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

-- Que insumos vende cada proveedor, a que precio, y bajo que nombre propio
-- (nombre_producto es la denominacion real de la factura de ESE proveedor —
-- pieza clave para matchear facturas automaticamente contra el catalogo de
-- insumos). insumo_id puede ser NULL: un producto del proveedor todavia sin
-- vincular a ningun insumo del catalogo.
CREATE TABLE IF NOT EXISTS proveedor_insumos (
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

-- Config compartida entre dispositivos, de baja frecuencia de escritura (a
-- diferencia de insumos/productos, que tienen su propia tabla). Cada fila es
-- un id fijo + un blob JSON — hoy solo se usa para "variantes_grupos"
-- (Gestion > Variantes), pero sirve para cualquier config futura que deba
-- verse igual en todos los dispositivos sin ameritar una tabla propia.
CREATE TABLE IF NOT EXISTS configuracion_compartida (
  id             TEXT PRIMARY KEY,
  valor          JSONB NOT NULL,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Producción diaria
CREATE TABLE IF NOT EXISTS produccion_diaria (
  id             TEXT PRIMARY KEY,
  producto_id    TEXT NOT NULL REFERENCES productos(id),
  fecha          TEXT NOT NULL,
  cantidad       INTEGER NOT NULL DEFAULT 0,
  creado_en      TIMESTAMPTZ DEFAULT NOW(),
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

-- Movimientos de stock de productos
CREATE TABLE IF NOT EXISTS movimientos_stock (
  id              BIGSERIAL PRIMARY KEY,
  uuid            TEXT UNIQUE,
  producto_id     TEXT REFERENCES productos(id),
  tipo            TEXT CHECK (tipo IN ('venta', 'produccion', 'ajuste_stock', 'ajuste_manual', 'devolucion')),
  cantidad        INTEGER,
  stock_anterior  INTEGER,
  stock_nuevo     INTEGER,
  motivo          TEXT,
  referencia      TEXT,
  fecha           TEXT,
  creado_en       TIMESTAMPTZ DEFAULT NOW()
);

-- Stock actual de productos terminados — solo lo que cambia (el catalogo
-- nombre/precio/categoria ya es identico en todos los dispositivos via seed
-- local). Se usa para que "modo consulta" en otros dispositivos vea el mismo
-- stock que la tablet del local, sin duplicar el catalogo completo.
--
-- Este valor NO se sube directo desde la app: se deriva solo, con el trigger
-- de abajo, a partir de cada fila que llega a movimientos_stock. Antes la
-- tablet subia el stock de dos formas independientes (una foto aparte +
-- el detalle del movimiento) y podian contradecirse si una de las dos
-- fallaba por wifi — eso aparecio como "stock negativo" en agosto 2026.
CREATE TABLE IF NOT EXISTS stock_productos (
  id             TEXT PRIMARY KEY REFERENCES productos(id),
  stock_actual   NUMERIC NOT NULL DEFAULT 0,
  actualizado_en TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION stock_productos_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.producto_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO stock_productos (id, stock_actual, actualizado_en)
  VALUES (NEW.producto_id, NEW.stock_nuevo, NEW.creado_en)
  ON CONFLICT (id) DO UPDATE
    SET stock_actual = EXCLUDED.stock_actual,
        actualizado_en = EXCLUDED.actualizado_en
    -- El guard por creado_en evita que un movimiento que llega tarde
    -- (reintento de la cola offline) pise con un valor viejo un total mas
    -- nuevo que ya llego por otro camino.
    WHERE stock_productos.actualizado_en IS NULL
       OR stock_productos.actualizado_en <= EXCLUDED.actualizado_en;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_productos_desde_movimiento ON movimientos_stock;
CREATE TRIGGER trg_stock_productos_desde_movimiento
  AFTER INSERT OR UPDATE ON movimientos_stock
  FOR EACH ROW
  EXECUTE FUNCTION stock_productos_desde_movimiento();

-- produccion_diaria.cantidad tampoco se sube directo desde la app (igual
-- principio que stock_productos arriba): se deriva solo, sumando cada fila
-- tipo "produccion" que llega a movimientos_stock. Antes cada dispositivo
-- empujaba su propio contador entero (upsert por "fecha:producto_id"), y si
-- dos dispositivos cargaban produccion del mismo producto el mismo dia, el
-- que empujaba ultimo pisaba al otro en vez de sumarse — causa raiz
-- confirmada de los incidentes del 13, 15 y 19/09/2026.
--
-- Solo AFTER INSERT (nunca UPDATE): un reintento de sync que en realidad ya
-- se habia guardado hace un upsert por uuid, que es un UPDATE si la fila ya
-- existe. Si el trigger tambien corriera en UPDATE, ese reintento sumaria la
-- misma produccion dos veces.
CREATE OR REPLACE FUNCTION produccion_diaria_desde_movimiento()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.tipo != 'produccion' OR NEW.producto_id IS NULL OR NEW.fecha IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO produccion_diaria (id, producto_id, fecha, cantidad, creado_en, actualizado_en)
  VALUES (NEW.fecha || ':' || NEW.producto_id, NEW.producto_id, NEW.fecha, NEW.cantidad, NEW.creado_en, NEW.creado_en)
  ON CONFLICT (id) DO UPDATE
    SET cantidad = produccion_diaria.cantidad + EXCLUDED.cantidad,
        actualizado_en = GREATEST(produccion_diaria.actualizado_en, EXCLUDED.actualizado_en);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_produccion_diaria_desde_movimiento ON movimientos_stock;
CREATE TRIGGER trg_produccion_diaria_desde_movimiento
  AFTER INSERT ON movimientos_stock
  FOR EACH ROW
  EXECUTE FUNCTION produccion_diaria_desde_movimiento();

-- Stock actual de insumos (materias primas) — separado de la definicion en
-- insumos por el mismo motivo que stock_productos arriba, pero derivado por
-- SUMA de deltas (no por snapshot con guarda de fecha): a diferencia de
-- productos, que tiene un solo escritor real (la tablet), insumos tiene
-- MULTIPLES escritores concurrentes (el celu escribe compras por factura, la
-- tablet escribe consumo por produccion/venta/calibracion, sobre los mismos
-- insumos, al mismo tiempo) — con varios escritores, sumar deltas es lo unico
-- que da el mismo resultado sin importar el orden de llegada (migracion 012).
CREATE TABLE IF NOT EXISTS stock_insumos (
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

DROP TRIGGER IF EXISTS trg_stock_insumos_desde_movimiento ON movimientos_insumos;
CREATE TRIGGER trg_stock_insumos_desde_movimiento
  AFTER INSERT OR UPDATE OR DELETE ON movimientos_insumos
  FOR EACH ROW
  EXECUTE FUNCTION stock_insumos_desde_movimiento();

-- Pedidos (Instagram/WhatsApp) — fuente de verdad en Supabase, no en IDB local
CREATE TABLE IF NOT EXISTS pedidos (
  id                BIGSERIAL PRIMARY KEY,
  cliente_nombre    TEXT NOT NULL,
  fecha_hora_retiro TIMESTAMPTZ NOT NULL,
  pagado            BOOLEAN NOT NULL DEFAULT false,
  cortado_mitad     BOOLEAN NOT NULL DEFAULT false,
  aclaraciones      TEXT,
  total_centavos    INTEGER NOT NULL DEFAULT 0, -- editable a mano: puede diferir del catalogo por promos fuera del sistema
  estado            TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'entregado')),
  creado_en         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  listo_en          TIMESTAMPTZ,
  entregado_en      TIMESTAMPTZ
);

-- Detalle de pedido (líneas)
CREATE TABLE IF NOT EXISTS detalle_pedido (
  id                       BIGSERIAL PRIMARY KEY,
  pedido_id                BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  producto_id              TEXT NOT NULL REFERENCES productos(id),
  producto_nombre          TEXT NOT NULL,
  cantidad                 INTEGER NOT NULL,
  precio_unitario_centavos INTEGER NOT NULL DEFAULT 0
);

-- =========================================
-- RLS con Auth (usuario/contraseña, Supabase Auth)
-- La app ahora exige login (3 cuentas: Augusto, Sharon, Guadalupe) antes de
-- llamar a Supabase. El anon key sin sesion no puede hacer NADA — ni leer ni
-- escribir ninguna tabla. Una vez logueado, cualquiera de las 3 cuentas puede
-- ver y operar todo (no hay roles distintos entre ellas — negocio de un solo
-- local, no hace falta separar permisos por usuario).
-- =========================================
ALTER TABLE categorias             ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ventas                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_venta          ENABLE ROW LEVEL SECURITY;
ALTER TABLE insumos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE recetas                ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_insumos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_recetas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_calibraciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE produccion_diaria      ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimientos_stock      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos                ENABLE ROW LEVEL SECURITY;
ALTER TABLE detalle_pedido         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_productos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_insumos          ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedor_insumos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_compartida ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario autenticado (las 3 cuentas) puede leer, insertar y
-- actualizar todas las tablas. DELETE solo existe en pedidos/detalle_pedido
-- (la app borra pedidos a proposito); el resto de las tablas no tiene policy
-- de DELETE porque la app nunca borra esas filas (correcciones puntuales via
-- SQL Editor, como el 19/09/2026, son la excepcion manual, no un camino que
-- use la app).
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

CREATE POLICY insumos_select ON insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY insumos_insert ON insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY insumos_update ON insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY recetas_select ON recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY recetas_insert ON recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY recetas_update ON recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY movimientos_insumos_select ON movimientos_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY movimientos_insumos_insert ON movimientos_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY movimientos_insumos_update ON movimientos_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY historial_recetas_select ON historial_recetas FOR SELECT TO authenticated USING (true);
CREATE POLICY historial_recetas_insert ON historial_recetas FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY historial_recetas_update ON historial_recetas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

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

CREATE POLICY stock_insumos_select ON stock_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY stock_insumos_insert ON stock_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY stock_insumos_update ON stock_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY proveedores_select ON proveedores FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedores_insert ON proveedores FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY proveedores_update ON proveedores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY proveedor_insumos_select ON proveedor_insumos FOR SELECT TO authenticated USING (true);
CREATE POLICY proveedor_insumos_insert ON proveedor_insumos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY proveedor_insumos_update ON proveedor_insumos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY configuracion_compartida_select ON configuracion_compartida FOR SELECT TO authenticated USING (true);
CREATE POLICY configuracion_compartida_insert ON configuracion_compartida FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY configuracion_compartida_update ON configuracion_compartida FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Índices útiles para queries del dashboard
CREATE INDEX IF NOT EXISTS idx_productos_categoria_id      ON productos(categoria_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha                ON ventas(fecha);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_venta_id      ON detalle_venta(venta_id);
CREATE INDEX IF NOT EXISTS idx_detalle_venta_fecha         ON detalle_venta(fecha);
CREATE INDEX IF NOT EXISTS idx_recetas_producto_id         ON recetas(producto_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_insumo_id       ON movimientos_insumos(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumos_fecha           ON movimientos_insumos(fecha);
CREATE INDEX IF NOT EXISTS idx_histcal_insumo_id           ON historial_calibraciones(insumo_id);
CREATE INDEX IF NOT EXISTS idx_histrecetas_receta_id       ON historial_recetas(receta_id);
CREATE INDEX IF NOT EXISTS idx_mov_stock_fecha             ON movimientos_stock(fecha);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado              ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_retiro        ON pedidos(fecha_hora_retiro);
CREATE INDEX IF NOT EXISTS idx_detalle_pedido_pedido_id    ON detalle_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_produccion_diaria_fecha     ON produccion_diaria(fecha);
CREATE INDEX IF NOT EXISTS idx_prov_insumos_proveedor_id   ON proveedor_insumos(proveedor_id);
CREATE INDEX IF NOT EXISTS idx_prov_insumos_insumo_id      ON proveedor_insumos(insumo_id);
