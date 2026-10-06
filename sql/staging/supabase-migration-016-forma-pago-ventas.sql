-- Migracion 016: forma de pago (efectivo / tarjeta) en cada venta
--
-- Hasta ahora la app no sabia como se cobro cada venta — el Cierre de caja
-- (migracion 015) dependia 100% de que alguien tipeara a mano el total de
-- tarjeta del dia. Con este campo, la Caja pregunta la forma de pago al
-- confirmar (un toggle, como el de ToGoo) y el Cierre puede mostrar "segun
-- el sistema" al lado de lo que se carga a mano del cierre de Postnet, como
-- cruce de control — el Postnet sigue siendo la fuente de verdad del total
-- de tarjeta (puede diferir por errores de tipeo en la app), pero ahora hay
-- con que compararlo.
--
-- Default 'efectivo': las ventas viejas (de antes de esta migracion) no
-- tienen forma de pago registrada, y en este negocio la mayoria es efectivo
-- — es la mejor suposicion sin inventar un tercer estado "desconocido" que
-- complicaria cada reporte que lea esta columna.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE ventas ADD COLUMN IF NOT EXISTS forma_pago TEXT NOT NULL DEFAULT 'efectivo';

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_forma_pago_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_forma_pago_check CHECK (forma_pago IN ('efectivo', 'tarjeta'));

NOTIFY pgrst, 'reload schema';
