-- Migracion 019: separar "cada cuanto pido" de "cuanto tarda en llegar"
--
-- `dias_ciclo` venia mezclando dos cosas que son independientes:
--
--   dias_ciclo      = cada cuanto le hago un pedido a este proveedor
--   lead_time_dias  = cuantos dias pasan desde que lo pido hasta que lo tengo
--
-- Mezcladas, la lista de compras calculaba mal el horizonte que tiene que
-- cubrir cada pedido. El stock de hoy no tiene que aguantar hasta el proximo
-- pedido: tiene que aguantar hasta que LLEGUE el proximo pedido, que es un
-- ciclo mas un lead time despues. Con Los Reyunos (ciclo 14, tarda ~5) eso son
-- 19 dias, no 14: al pedido le faltaba un 26%, y la rotura aparecia cinco dias
-- despues del pedido, cuando ya nadie la relacionaba con la lista de compras.
-- Medido sobre los 15 dias de staging, ignorar el lead time es la diferencia
-- entre 4 y 176 dias con rotura (de 1680 dias-insumo), y no se arregla pidiendo
-- mas: ni con 8 veces el colchon llega al 99% de servicio.
--
-- `dias_entrega` son los dias fijos de la semana en que el proveedor entrega,
-- como array de enteros con la convencion de Postgres/JS: 0=domingo ... 6=sabado.
-- Mercadona entrega martes, miercoles y viernes -> '{2,3,5}'. Eso ya estaba
-- escrito en las notas del proveedor, o sea que el modelo no lo usaba. Importa
-- porque define cuantos dias hay que cubrir de verdad: si hoy es jueves y
-- entrega mar/mie/vie, el pedido de hoy llega el viernes y el siguiente no
-- llega hasta el martes. NULL o array vacio = entrega cualquier dia.
--
-- Los valores que se cargan abajo son SUPUESTOS razonables para arrancar, no
-- datos confirmados por el dueño. Hay que repasarlos con el: el lead time es
-- el dato con mas peso de todo el modelo nuevo.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS lead_time_dias INTEGER;
ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS dias_entrega   INTEGER[];

COMMENT ON COLUMN proveedores.dias_ciclo     IS 'Cada cuantos dias se le hace un pedido a este proveedor.';
COMMENT ON COLUMN proveedores.lead_time_dias IS 'Dias entre hacer el pedido y tener la mercaderia en la puerta. 0 = cash&carry (vas y traes).';
COMMENT ON COLUMN proveedores.dias_entrega   IS 'Dias fijos de entrega, 0=domingo..6=sabado. NULL/vacio = cualquier dia.';

-- Valores de arranque. Solo donde todavia no hay nada cargado, para no pisar
-- lo que el dueño ya haya corregido a mano.
UPDATE proveedores SET lead_time_dias = v.lead, dias_entrega = v.entrega
FROM (VALUES
  ('mercadona',           2, ARRAY[2,3,5]),  -- pedido online, entrega mar/mie/vie
  ('tropicalia',          3, NULL::INTEGER[]),
  ('reyunos',             5, NULL::INTEGER[]),
  ('jasa',                2, NULL::INTEGER[]),
  ('kaffetto',            4, NULL::INTEGER[]),
  ('makro',               0, NULL::INTEGER[]),  -- cash&carry en Albuixech: vas y traes
  ('delicias-vegetales',  2, NULL::INTEGER[]),
  ('pampa',               4, NULL::INTEGER[])
) AS v(id, lead, entrega)
WHERE proveedores.id = v.id AND proveedores.lead_time_dias IS NULL;

-- Cualquier proveedor que no este en la lista de arriba (cargado por el dueño
-- despues) arranca en 0: "lo tengo el mismo dia". Es el supuesto que menos
-- cambia respecto del comportamiento viejo, asi que nadie se encuentra con que
-- la app le pide de golpe el doble sin haber tocado nada.
UPDATE proveedores SET lead_time_dias = 0 WHERE lead_time_dias IS NULL;
