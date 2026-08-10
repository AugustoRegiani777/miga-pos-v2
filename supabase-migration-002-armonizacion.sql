-- =========================================
-- Miga POS v2 — Migracion 002: armonizacion del schema
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- -----------------------------------------
-- 1) Catalogo de productos (la tabla que faltaba)
-- Espejo de src/modules/seed.js — initialCategories/initialProducts. No se
-- sincroniza fila por fila como el resto: se sube entera cada vez que el
-- catalogo cambia en el codigo (ver pushCatalogoSnapshot en supabase.js).
-- -----------------------------------------
CREATE TABLE IF NOT EXISTS categorias (
  id    TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS productos (
  id               TEXT PRIMARY KEY,
  categoria_id     TEXT NOT NULL REFERENCES categorias(id),
  nombre           TEXT NOT NULL,
  precio_centavos  INTEGER NOT NULL DEFAULT 0,
  sandwich_tipo    TEXT,
  umbral_bajo      INTEGER NOT NULL DEFAULT 0,
  controla_stock   BOOLEAN NOT NULL DEFAULT true,
  orden            INTEGER NOT NULL DEFAULT 0,
  activo           BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE categorias ENABLE ROW LEVEL SECURITY;
ALTER TABLE productos  ENABLE ROW LEVEL SECURITY;
CREATE POLICY categorias_select ON categorias FOR SELECT TO authenticated USING (true);
CREATE POLICY categorias_insert ON categorias FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY categorias_update ON categorias FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY productos_select ON productos FOR SELECT TO authenticated USING (true);
CREATE POLICY productos_insert ON productos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY productos_update ON productos FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_productos_categoria_id ON productos(categoria_id);

INSERT INTO categorias (id, nombre, orden) VALUES
  ('sandwiches', 'Sandwiches', 1),
  ('bolleria', 'Bolleria', 2),
  ('cafe', 'Cafe', 3),
  ('bebidas', 'Bebidas', 4)
ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden;

INSERT INTO productos (id, categoria_id, nombre, precio_centavos, sandwich_tipo, umbral_bajo, controla_stock, orden, activo) VALUES
  ('jamon-queso', 'sandwiches', 'Jamon y queso', 350, 'basico', 15, true, 1, true),
  ('pasta-oliva-queso', 'sandwiches', 'Pasta Oliva y queso', 350, 'basico', 15, true, 2, true),
  ('pimiento-gouda-philp', 'sandwiches', 'Pimiento asado, gouda, philp', 350, 'basico', 15, true, 3, true),
  ('pesto-tomate-queso', 'sandwiches', 'Pesto, tomate y queso', 350, 'basico', 15, true, 4, true),
  ('berenjena-brie', 'sandwiches', 'Berenjena y queso brie', 350, 'basico', 15, true, 5, true),
  ('jamon-serrano-rucula', 'sandwiches', 'Jamon serrano y rucula', 350, 'basico', 10, true, 6, true),
  ('atun-palta-queso', 'sandwiches', 'Atun, palta y queso', 380, 'premium', 10, true, 7, true),
  ('huevo-jamon', 'sandwiches', 'Huevo y Jamon', 380, 'premium', 10, true, 8, true),
  ('huevo-queso', 'sandwiches', 'Huevo y Queso', 380, 'premium', 10, true, 9, true),
  ('especial-semanal', 'sandwiches', 'Especial semanal', 380, 'premium', 10, true, 10, true),
  ('promo-bebida', 'sandwiches', 'Promo bebiba', 100, 'basico', 0, false, 11, true),
  ('promo-cafe-con-leche', 'sandwiches', 'Promo Cafe con leche', 240, NULL, 0, false, 12, true),
  ('croissant', 'bolleria', 'Croissant', 150, NULL, 4, true, 1, true),
  ('mini-croissant', 'bolleria', 'Mini croissant', 100, NULL, 4, true, 2, true),
  ('mini-croissant-ddl', 'bolleria', 'Mini croissant ddl', 120, NULL, 4, true, 3, true),
  ('pain-au-chocolat', 'bolleria', 'Pain au chocolat', 150, NULL, 4, true, 4, true),
  ('chipa', 'bolleria', 'Chipa', 100, NULL, 4, true, 5, true),
  ('alfajor-havana', 'bolleria', 'Alfajor Havana', 300, NULL, 0, false, 6, true),
  ('cookies', 'bolleria', 'Cookies', 300, NULL, 4, true, 7, true),
  ('medialunas', 'bolleria', 'Medialunas', 230, NULL, 4, true, 8, true),
  ('expresso-30ml', 'cafe', 'Expresso 30ml', 150, NULL, 0, false, 1, true),
  ('cortado', 'cafe', 'Cortado', 200, NULL, 0, false, 2, true),
  ('latte', 'cafe', 'Latte', 280, NULL, 0, false, 3, true),
  ('cafe-con-leche', 'cafe', 'Cafe con leche', 280, NULL, 0, false, 4, true),
  ('capuccino', 'cafe', 'Capuccino', 280, NULL, 0, false, 6, true),
  ('americano', 'cafe', 'Americano', 200, NULL, 0, false, 7, true),
  ('flat-white', 'cafe', 'Flat white', 300, NULL, 0, false, 8, true),
  ('ice-latte', 'cafe', 'Ice Latte', 300, NULL, 0, false, 9, true),
  ('ice-caramel', 'cafe', 'Ice Caramel', 320, NULL, 0, false, 10, true),
  ('cerveza', 'bebidas', 'Cerveza', 250, NULL, 0, false, 1, true),
  ('coca-cola', 'bebidas', 'Coca cola', 200, NULL, 0, false, 2, true),
  ('sprite', 'bebidas', 'Sprite', 200, NULL, 0, false, 3, true),
  ('nestea', 'bebidas', 'Nestea', 200, NULL, 0, false, 4, true),
  ('aquiaros', 'bebidas', 'Aquiarios', 200, NULL, 0, false, 5, true),
  ('jugo', 'bebidas', 'Jugo', 200, NULL, 0, false, 6, true),
  ('agua', 'bebidas', 'Agua', 150, NULL, 0, false, 7, true)
ON CONFLICT (id) DO UPDATE SET
  categoria_id = EXCLUDED.categoria_id, nombre = EXCLUDED.nombre, precio_centavos = EXCLUDED.precio_centavos,
  sandwich_tipo = EXCLUDED.sandwich_tipo, umbral_bajo = EXCLUDED.umbral_bajo,
  controla_stock = EXCLUDED.controla_stock, orden = EXCLUDED.orden, activo = EXCLUDED.activo;

-- -----------------------------------------
-- 2) Foreign keys que hoy cierran limpio (auditado contra los datos reales
-- antes de escribir esto — cero filas violarian estas reglas)
-- -----------------------------------------
ALTER TABLE ventas ADD CONSTRAINT fk_ventas_pedido
  FOREIGN KEY (pedido_id) REFERENCES pedidos(id);

ALTER TABLE produccion_diaria ADD CONSTRAINT fk_produccion_producto
  FOREIGN KEY (producto_id) REFERENCES productos(id);

ALTER TABLE movimientos_stock ADD CONSTRAINT fk_movstock_producto
  FOREIGN KEY (producto_id) REFERENCES productos(id);

ALTER TABLE stock_productos ADD CONSTRAINT fk_stockprod_producto
  FOREIGN KEY (id) REFERENCES productos(id);

ALTER TABLE detalle_pedido ADD CONSTRAINT fk_detpedido_producto
  FOREIGN KEY (producto_id) REFERENCES productos(id);

-- detalle_venta.producto_id NO lleva FK a proposito: conviven productos
-- reales con marcadores sinteticos (combo-6, combo-12, togoo-fee,
-- ajuste-pedido-N) que nunca van a existir en `productos`. Forzar la FK
-- rompería cada combo/ToGoo que se cargue de aca en adelante. El dashboard
-- hace LEFT JOIN contra productos y trata lo que no matchea como lo que es.

-- -----------------------------------------
-- 3) movimientos_insumos: le faltaba producto_id (el consumo de insumos se
-- descuenta en produccion, no en la venta — venta_id_local nunca se llega
-- a usar en la practica; se deja la columna por compatibilidad, sin FK).
-- -----------------------------------------
ALTER TABLE movimientos_insumos ADD COLUMN IF NOT EXISTS producto_id TEXT REFERENCES productos(id);

-- -----------------------------------------
-- 4) CHECK constraints en los campos tipo-enum — valores confirmados contra
-- el codigo (business.js) Y contra los datos reales antes de escribir esto.
-- -----------------------------------------
ALTER TABLE ventas ADD CONSTRAINT chk_ventas_sale_mode
  CHECK (sale_mode IN ('normal', 'togoo', 'baja'));

ALTER TABLE pedidos ADD CONSTRAINT chk_pedidos_estado
  CHECK (estado IN ('pendiente', 'listo', 'entregado'));

ALTER TABLE movimientos_stock ADD CONSTRAINT chk_movstock_tipo
  CHECK (tipo IN ('venta', 'produccion', 'ajuste_stock', 'ajuste_manual', 'devolucion'));

ALTER TABLE movimientos_insumos ADD CONSTRAINT chk_movinsumos_tipo
  CHECK (tipo IN ('compra', 'desperdicio', 'no_recibido', 'error_conteo', 'produccion', 'venta'));
