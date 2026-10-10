-- Migracion 023: Glovo como forma de pago
--
-- Hoy una venta se cobra en efectivo o con tarjeta (migracion 016). Glovo no es
-- ninguna de las dos: la plataforma cobra al cliente y despues le liquida al
-- local, asi que esa plata NO entra al cajon ni al Postnet. Se cargaba a mano
-- en el cierre ("Plataformas (Glovo...)"), y el sistema no podia saber cuanto
-- era.
--
-- Con 'glovo' como tercera forma de pago, la Caja lo pregunta al confirmar (un
-- toque, como el toggle de ToGoo) y el Cierre completa solo el total de
-- plataformas. Y el efectivo esperado sigue dando bien: se calcula por
-- coincidencia exacta con 'efectivo', asi que una venta 'glovo' nunca se cuenta
-- como plata en el cajon.
--
-- AVISO PARA EL DASHBOARD (miga-dashboard): aparece un valor nuevo en
-- ventas.forma_pago. No cambia el total facturado (total_centavos sigue siendo
-- lo vendido), pero todo lo que agrupe o filtre por forma_pago va a ver un
-- tercer grupo. Es de solo lectura, no se rompe; conviene avisarle.
--
-- IMPORTANTE: correr ESTO ANTES de usar Glovo en la Caja. Si la app intenta
-- guardar una venta 'glovo' y la base todavia no la acepta, el push falla con un
-- 23514, queda trabado en la cola, y una cola trabada desactiva la reconciliacion
-- de stock (es lo que corrompio el stock el 05/10).
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE ventas DROP CONSTRAINT IF EXISTS ventas_forma_pago_check;
ALTER TABLE ventas ADD CONSTRAINT ventas_forma_pago_check CHECK (forma_pago IN ('efectivo', 'tarjeta', 'glovo'));

NOTIFY pgrst, 'reload schema';
