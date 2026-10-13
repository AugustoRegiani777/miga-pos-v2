# SQL de Supabase

- `produccion/` — schema y migraciones ya aplicadas (o listas para aplicar) en la base REAL (`iknytfgqkdddtqpykgab`). Numeradas en orden; una vez corrida en produccion, no se edita.
- `staging/` — todo lo de la base de PRUEBA (`yfveeikzckvqlndmhwut`): su schema completo y las migraciones que se prueban ahi primero.

Flujo: una migracion nueva nace en `staging/`, se prueba, y recien cuando esta validada se copia a `produccion/` y se corre en la base real.
Pendiente de promover a produccion: `staging/supabase-migration-014-venta-uuid-en-movimientos.sql`.
