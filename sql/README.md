# SQL de Supabase

- `produccion/` — schema y migraciones de la base VIEJA (`iknytfgqkdddtqpykgab`), que dejo de usarse el 13/10/2026. Se conserva como archivo; no se corre mas.
- `staging/` — el esquema y las migraciones de la base NUEVA (`yfveeikzckvqlndmhwut`), que desde el 13/10/2026 es la base REAL. Una base de pruebas nueva se arma con estos mismos archivos.

Flujo desde ahora: una migracion nueva se escribe aca, se prueba en una base de pruebas (hay que crearla), y recien despues se corre en la real.
