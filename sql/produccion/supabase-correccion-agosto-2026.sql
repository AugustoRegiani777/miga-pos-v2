-- =========================================
-- Miga POS v2 — Correccion de datos: estandarizacion de agosto 2026
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente de movimientos_stock.
-- Preparado: 2026-09-02, por la investigacion del stock que no cerraba en
-- agosto (ver conversacion / memoria del proyecto).
-- =========================================

-- Estandarizacion agosto 2026: 10 correcciones retroactivas a movimientos_stock
-- Filas NUEVAS unicamente, no se toca ni se borra nada existente.
-- creado_en = fecha real de esta correccion (02/09/2026), fecha = dia que corrige.
--
-- 8 filas cierran huecos reales de sync (ventas que nunca llegaron a
-- Supabase, mismo bug ya diagnosticado y arreglado en la migracion 004):
-- Jamon y queso, Jamon serrano rucula, Huevo y queso, Huevo y jamon, Atun
-- palta queso en 30/08 y 31/08.
--
-- 2 filas anulan un ajuste erroneo del 02/08 (dos "Recuento de stock" a las
-- 15:18, con stock_anterior=0 en ambas — no encajan en la cadena real de ese
-- dia, todo lo demas de esa jornada cierra perfecto si se las ignora; todo
-- indica que vinieron de otro dispositivo/sesion sin historial local, no de
-- una venta perdida real).

INSERT INTO movimientos_stock (uuid, producto_id, tipo, cantidad, stock_anterior, stock_nuevo, motivo, referencia, fecha, creado_en) VALUES
  ('24de2f61-4374-4de0-8419-a01ce113a63e', 'jamon-queso', 'ajuste_stock', -4, 13, 9, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-30', '2026-09-02T10:58:12.940Z'),
  ('d536df08-8411-473b-ae0b-6ab0c4792573', 'jamon-queso', 'ajuste_stock', -4, 13, 9, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-31', '2026-09-02T10:58:12.940Z'),
  ('82c69755-0fe9-43b8-b50a-a73ec626b63c', 'jamon-serrano-rucula', 'ajuste_stock', -2, 5, 3, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-30', '2026-09-02T10:58:12.940Z'),
  ('ab235669-a2e8-45fe-bfd7-151803c5ce4f', 'jamon-serrano-rucula', 'ajuste_stock', -3, 5, 2, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-31', '2026-09-02T10:58:12.940Z'),
  ('9860df2e-61e7-4c2b-a275-29ceacf7f680', 'atun-palta-queso', 'ajuste_stock', -2, 2, 0, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-30', '2026-09-02T10:58:12.940Z'),
  ('6f51872e-8d62-4cf1-b58a-1fa1ee3ec64d', 'huevo-jamon', 'ajuste_stock', -2, 6, 4, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-30', '2026-09-02T10:58:12.940Z'),
  ('cb88ec31-ce5d-4a2d-8eb1-a0f87c19a5ae', 'huevo-queso', 'ajuste_stock', -2, 6, 4, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-30', '2026-09-02T10:58:12.940Z'),
  ('e8b554ee-2a40-4bd7-97b2-2c9577991429', 'huevo-queso', 'ajuste_stock', -5, 6, 1, 'Correccion retroactiva', 'Estandarizacion agosto 2026: venta no sincronizada (bug de arquitectura de sync, corregido 01/09/2026)', '2026-08-31', '2026-09-02T10:58:12.940Z'),
  ('739f8ac1-04fc-4f86-a963-af8d11be99c6', 'jamon-queso', 'ajuste_stock', -10, 10, 0, 'Correccion retroactiva', 'Estandarizacion agosto 2026: anula ajuste erroneo de sesion/dispositivo distinto (recuento de prueba a las 15:18 que nunca afecto el stock real)', '2026-08-02', '2026-09-02T10:58:12.940Z'),
  ('75ccc192-8209-4327-8dae-93a5ada4c078', 'atun-palta-queso', 'ajuste_stock', -10, 10, 0, 'Correccion retroactiva', 'Estandarizacion agosto 2026: anula ajuste erroneo de sesion/dispositivo distinto (recuento de prueba a las 15:18 que nunca afecto el stock real)', '2026-08-02', '2026-09-02T10:58:12.940Z');

-- Restaurar stock_productos: el INSERT de arriba dispara el trigger, que al ver
-- estas filas (fechadas en agosto pero creadas hoy) las trataria como "lo mas
-- reciente" y pisaria el stock actual real con el valor historico. Se restaura
-- exacto al valor que tenia stock_productos ANTES de este script (capturado
-- momentos antes de insertar).
--
-- El WHERE actualizado_en = '...10:58:12.940Z' (el creado_en de las filas de
-- arriba) es una salvaguarda: solo restaura si el trigger de verdad piso el
-- valor con el de esta correccion. Si en el medio hubo una venta real de
-- alguno de estos productos (con un creado_en mas nuevo que el de esta
-- correccion), el trigger ya la dejo intacta el solo, y este UPDATE no va a
-- encontrar coincidencia — no la va a pisar.
UPDATE stock_productos SET stock_actual = 9, actualizado_en = '2026-09-02T08:35:56.016+00:00' WHERE id = 'jamon-serrano-rucula' AND actualizado_en = '2026-09-02T10:58:12.940Z';
UPDATE stock_productos SET stock_actual = 9, actualizado_en = '2026-09-02T08:57:19.888+00:00' WHERE id = 'huevo-queso' AND actualizado_en = '2026-09-02T10:58:12.940Z';
UPDATE stock_productos SET stock_actual = 8, actualizado_en = '2026-09-02T09:07:23.331+00:00' WHERE id = 'huevo-jamon' AND actualizado_en = '2026-09-02T10:58:12.940Z';
UPDATE stock_productos SET stock_actual = 3, actualizado_en = '2026-09-01T17:28:53.708+00:00' WHERE id = 'atun-palta-queso' AND actualizado_en = '2026-09-02T10:58:12.940Z';
UPDATE stock_productos SET stock_actual = 27, actualizado_en = '2026-09-02T08:31:53.251+00:00' WHERE id = 'jamon-queso' AND actualizado_en = '2026-09-02T10:58:12.940Z';
