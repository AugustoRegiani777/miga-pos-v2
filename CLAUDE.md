# Miga POS — Documentación completa del proyecto

## Qué es este proyecto

Miga POS es un sistema de punto de venta (POS) diseñado a medida para una sandwichería artesanal llamada **Miga**. Fue construido para reemplazar el registro manual en papel o planillas de Excel, con foco en simplicidad operativa: una persona sola manejando la caja, producción y stock desde una tablet.

No es un producto genérico. Cada decisión de diseño responde a las necesidades concretas de este negocio.

---

## Cómo nació (v1)

El negocio necesitaba:
- Registrar ventas rápido desde la caja sin fricción
- Controlar cuántos sandwiches quedan disponibles cada día
- Saber cuánto se produjo y cuánto se vendió
- Tener un historial básico de ventas diarias
- Exportar un resumen al cierre del día

La decisión fue construir una **PWA (Progressive Web App)** que corre 100% local en una tablet Android, sin internet, sin servidor externo, sin costo de hosting. Los datos viven en el navegador (IndexedDB). Un HTTP File Server de Android sirve los archivos estáticos.

### Stack v1

- Vanilla JS (ES Modules, sin framework, sin build step)
- HTML + CSS puro
- IndexedDB como base de datos local (via wrapper idb.js)
- Service Worker para cache offline
- Sin NPM, sin Node.js, sin dependencias externas
- Deploy: zip de archivos → tablet Android → HTTP File Server

### Lo que registra v1

**Caja (ventas):**
- Productos organizados por categoría con precio
- Carrito de compras con cantidades
- Confirmación de venta → registra en historial
- Combos automáticos (lógica de precio especial si se combinan ciertos productos)
- Modo ToGoo: salida de stock para pedidos para llevar sin cobrar en caja

**Producción:**
- Carga de producción por sandwich (cuántos se hicieron en el día)
- Movimientos: alta normal, ajuste por error, baja
- Comentarios de producción del día
- Timeline de producción con horarios

**Stock:**
- Stock disponible por producto (sandwiches y bollería)
- Ajuste manual de stock con motivo (recuento, consumo, error, pedidos offline)
- Indicadores visuales: OK / Bajo / Agotado

**Historial:**
- Ventas del día con detalle de productos y totales
- Filtro por fecha
- Exportación TXT con resumen de caja y producción

### Limitaciones de v1

- Los datos solo existen en esa tablet. Si se rompe, se pierde todo.
- No se puede ver el negocio desde otro dispositivo.
- No hay control de insumos (solo stock de producto terminado).
- Las actualizaciones de la app requieren transferir un zip manualmente.
- El Service Worker cachea agresivamente → hay que incrementar la versión manualmente en cada deploy.

---

## La evolución: v2

v2 es la misma app pero con tres grandes mejoras:

### 1. Aprovisionamiento con recetas (prioridad inmediata)

El negocio necesita saber cuándo comprar insumos antes de quedarse sin stock. La idea es:

- Definir **insumos** (jamón, queso, miga de pan, etc.) con unidad de medida libre (g, kg, feta, plancha, unidad)
- Definir **recetas** por producto: qué insumos consume cada sandwich vendido y en qué cantidad
- Cuando se confirma una venta, el sistema **descuenta automáticamente** los insumos usados según la receta × cantidad vendida
- Alertas visuales cuando un insumo cae bajo stock mínimo (amarillo) o crítico (rojo)
- **Lista de compras** generada automáticamente con lo que hay que reponer, exportable como TXT

**Ejemplo de receta:**
```
Sandwich Jamón y Queso:
  - Jamón cocido     100g  por unidad
  - Queso en fetas   80g   por unidad
  - Miga de pan      0.5 plancha por unidad  (1 plancha = 2 sandwiches)
```

**Complejidad de unidades:**
Las unidades son libres. El negocio define cómo mide cada insumo. Por ejemplo:
- El pan viene en planchas (capas), 1 plancha alcanza para 2 sandwiches
- El jamón se mide en gramos o en fetas
- El aceite de oliva puede medirse en ml o en "chorros"
El sistema no convierte unidades, simplemente opera en la unidad que el usuario define.

### 2. Sincronización en la nube (Supabase)

Migrar la capa de datos de IndexedDB a Supabase (PostgreSQL):

- Los datos se guardan en la nube automáticamente
- Si la tablet se rompe, no se pierde nada
- El dueño puede ver ventas y alertas desde su teléfono
- Múltiples dispositivos ven los mismos datos en tiempo real

**Estrategia offline-first:**
La tablet puede quedarse sin WiFi. El flujo es:
1. La venta se guarda en IndexedDB local primero (instantáneo)
2. Si hay conexión, sincroniza a Supabase inmediatamente
3. Si no hay conexión, se encola y sincroniza cuando vuelve el WiFi
4. El dueño ve los datos en tiempo real desde su teléfono cuando hay sync

### 3. Dashboard del dueño (futuro)

Vista simplificada para ver desde el teléfono:
- Ventas del día en curso
- Stock crítico de insumos
- Producción cargada
- Total de caja del día

---

## Stack v2

| Capa | Tecnología | Por qué |
|------|-----------|---------|
| Frontend | Vanilla JS (ES Modules) | Ya está, funciona, no hay razón para cambiar |
| UI | HTML + CSS puro | Igual |
| Base de datos | Supabase (PostgreSQL) | Free tier generoso, API REST automática, auth incluido |
| Cache local | IndexedDB | Offline-first, mismo patrón que v1 |
| Hosting | Vercel | Free tier, deploy automático desde GitHub |
| Auth | Supabase Auth | Para acceso del dueño desde el teléfono |
| Service Worker | Reescrito | Cache más inteligente para modo híbrido online/offline |

**Sin costo mientras:**
- Supabase free tier: 500MB base de datos, 50k usuarios activos → el negocio no va a superar esto en años
- Vercel free tier: hosting ilimitado para proyectos personales
- GitHub free: repositorio privado

---

## Dataset / Modelo de datos

### Tablas en Supabase

```
productos
  id, nombre, categoriaId, precioCentavos, controlaStock, activo

categorias
  id, nombre, orden

ventas
  id, fecha, hora, totalCentavos, saleMode (normal/togoo/baja)

detalles_venta
  id, ventaId, productoId, productoNombre, cantidad, precioCentavos, subtotalCentavos

produccion
  id, productoId, fecha, cantidadProducida

movimientos_produccion
  id, produccionId, tipo, cantidad, motivo, creadoEn

stock_producto
  id, productoId, stockActual, stockDisponible, fecha

insumos (NUEVO v2)
  id, nombre, unidad, stockActual, stockMinimo, stockCritico, activo

recetas (NUEVO v2)
  id, productoId, insumoId, cantidadPorUnidad

movimientos_insumos (NUEVO v2)
  id, insumoId, tipo (venta/ajuste_manual/compra), cantidad, ventaId, creadoEn
```

### Volumen estimado

```
80 ventas/día × 365 = ~29.000 ventas/año
~3 items por venta = ~87.000 líneas de detalle/año
Movimientos de insumos ≈ misma escala
Producción: ~25 registros/día = ~9.000/año

Total año 1: ~200.000 registros → ~15-25 MB
Supabase free tier: 500 MB → años de margen
```

---

## Archivos del proyecto

### Copiados de v1 (no tocar, funcionan bien)

| Archivo | Qué hace |
|---------|---------|
| `src/ui/render.js` | Toda la renderización del DOM |
| `src/modules/business.js` | Lógica de negocio (ventas, stock, producción) |
| `src/modules/pricing.js` | Cálculo de precios y combos |
| `src/utils/format.js` | Formateo de moneda, fechas, texto |
| `assets/css/styles.css` | Todos los estilos |
| `index.html` | Estructura base de la UI |
| `manifest.json` | Configuración PWA |

### A reescribir en v2

| Archivo | Cambio |
|---------|--------|
| `src/db/idb.js` | Agregar sync con Supabase, mantener IndexedDB como cache |
| `src/app/app.js` | Adaptar para estado online/offline, nuevos módulos |
| `src/modules/seed.js` | Datos iniciales van a Supabase, no a IndexedDB |
| `src/modules/backup.js` | Ya no necesario (datos en nube) o reemplazar por export manual |

### Nuevos en v2

| Archivo | Qué hace |
|---------|---------|
| `src/modules/aprovisionamiento.js` | CRUD de insumos y recetas |
| `src/modules/sync.js` | Cola offline y sincronización con Supabase |
| `src/db/supabase.js` | Cliente Supabase y queries |
| `src/ui/render-aprovisionamiento.js` | UI del módulo de insumos |

---

## Orden de construcción

1. **Módulo aprovisionamiento local** — CRUD de insumos, recetas, descuento automático al vender, lista de compras. Todo en IndexedDB primero, sin Supabase todavía. La lógica tiene que funcionar bien antes de agregar la nube.

2. **Integración Supabase** — Migrar la capa de datos. Empezar por ventas e historial (los más críticos para no perder datos). Luego insumos y recetas.

3. **Sync offline-first** — Cola de operaciones pendientes cuando no hay WiFi.

4. **Auth + dashboard del dueño** — Vista de solo lectura para el teléfono.

---

## Criterios de diseño

- **Sin fricción en caja**: cada tap tiene que ser obvio. La persona que cobra no es técnica.
- **Offline primero**: la app tiene que funcionar aunque caiga el WiFi.
- **Sin costo**: todo en free tiers mientras el negocio sea chico.
- **Escalable sin reescribir**: si el negocio crece (segunda sucursal, más productos), la arquitectura aguanta.
- **Vanilla JS**: sin frameworks. Menos dependencias = menos cosas que romper.
