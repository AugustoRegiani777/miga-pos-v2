-- =========================================
-- Miga POS v2 — Migracion 003: un pedido nunca puede tener mas de una venta
-- Ejecutar en: Supabase Dashboard → SQL Editor
-- Aditiva: no borra ni modifica ninguna fila existente.
-- =========================================

-- Un pedido solo se marca "listo" una vez (patchEstadoPedido exige el
-- estado anterior "pendiente"), asi que pedido_id nunca deberia repetirse
-- entre ventas. El 20/07 un dia de wifi inestable hizo que el mismo pedido
-- se reintentara sincronizar decenas de veces, y como el chequeo de la app
-- (ver pushVenta en supabase.js) hace "leer, despues insertar" — dos
-- reintentos casi simultaneos podrian ambos leer "no existe" antes de que
-- ninguno termine de insertar. Este indice hace la regla imposible de
-- violar a nivel de base, no solo improbable a nivel de app: cualquier
-- segundo intento de insertar el mismo pedido_id falla con 23505
-- (unique_violation), y pushVenta ya sabe recuperarse de ese error
-- buscando la venta existente en vez de reintentar a ciegas.
CREATE UNIQUE INDEX IF NOT EXISTS ventas_pedido_id_unique
  ON ventas (pedido_id)
  WHERE pedido_id IS NOT NULL;
