-- Migracion 026: stock critico por producto
--
-- Hoy un producto con stock propio solo tiene "umbral bajo" (amarillo) y el cero (rojo). Se agrega un
-- umbral CRITICO propio: por debajo de el se ve en rojo, entre critico y minimo en amarillo, y por encima
-- en verde. 0 = sin critico (solo el cero), asi que nada cambia para lo que ya existe.
--
-- AVISO PARA EL DASHBOARD (miga-dashboard): columna nueva en `productos`. Solo lectura, no se rompe.
--
-- IMPORTANTE: correr ESTO ANTES de publicar el codigo. Si la app intenta subir un producto con
-- umbral_critico y la columna no existe, el envio falla (PGRST204) y queda trabado en la cola.
--
-- Idempotente: se puede correr mas de una vez sin efecto extra.

ALTER TABLE productos ADD COLUMN IF NOT EXISTS umbral_critico INTEGER NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
