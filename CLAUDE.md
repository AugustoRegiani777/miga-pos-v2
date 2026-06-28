# Miga POS v2

## Contexto del proyecto

Evolución de `miga-pos-pwa` (app local para tablet Android). Esta versión agrega:
- Módulo de aprovisionamiento con recetas y consumo automático
- Sincronización con Supabase (PostgreSQL en la nube)
- Acceso multi-dispositivo (tablet + teléfono del dueño)

El repo original (v1, solo tablet local) está en: `https://github.com/AugustoRegiani777/SistemaUnodeMiga`

## Stack

- Vanilla JS (ES modules, sin framework, sin build step)
- Supabase como backend (reemplaza IndexedDB)
- Vercel para hosting
- Sin TypeScript, sin NPM por ahora

## Archivos copiados de v1 (reusar sin cambios)

- `assets/css/styles.css`
- `src/ui/render.js`
- `src/modules/business.js`
- `src/modules/pricing.js`
- `src/utils/format.js`

## Archivos a reescribir

- `src/db/idb.js` → reemplazar por cliente Supabase
- `src/app/app.js` → refactorizar para online/offline
- `src/modules/seed.js` → datos van a Supabase
- `src/modules/backup.js` → ya no necesario (datos en nube)

## Módulos nuevos a construir

### 1. Aprovisionamiento (prioridad alta)

Entidades:
- **Insumos**: nombre, unidad (libre: g/kg/feta/plancha/unidad), stockActual, stockMinimo, stockCritico
- **Recetas**: vínculo producto → insumos con cantidad por unidad vendida

Ejemplo de receta:
- "Jamón y Queso" → Jamón cocido: 100g, Miga de pan: 0.5 plancha, Queso: 80g

Flujo:
1. Se confirma venta (ej: 3x Jamón y Queso)
2. Sistema descuenta automáticamente de cada insumo según receta × cantidad
3. Si insumo cae bajo stockMinimo → alerta amarilla
4. Si cae bajo stockCritico → alerta roja
5. Lista de compras: exporta TXT con insumos a reponer

### 2. Sync Supabase (después de aprovisionamiento)

Estrategia offline-first:
- IndexedDB como cache local
- Sync a Supabase cuando hay conexión
- Cola de operaciones pendientes si no hay WiFi

### 3. Dashboard del dueño (futuro)

- Vista de ventas del día desde el teléfono
- Alertas de stock crítico por notificación

## Volumen de datos estimado

- 80 transacciones/día → ~29.000 ventas/año
- ~200.000 registros totales al año
- ~15-25 MB/año → Supabase free tier más que suficiente

## Negocio

Sandwichería artesanal. Productos principales:
- Sandwiches (controlan stock de producción y de insumos)
- Bollería
- Bebidas y café (sin control de insumos por ahora)
- ToGoo: pedidos para llevar con descuento de stock

Operación: ~80 ventas/día, una sola tablet en caja, dueño quiere ver datos desde el teléfono.
