# Miga POS — Documentación maestra del proyecto

> **Para agentes IA:** Este archivo es la fuente de verdad del proyecto. Léelo completo antes de tocar cualquier archivo. Si algo en el código contradice este doc, confía en el código (el doc puede estar desactualizado en detalles) pero respeta los principios aquí documentados.

---

## 1. Qué es este proyecto

Miga POS es un sistema de punto de venta hecho a medida para **"Uno de Miga"**, una sandwichería artesanal en Valencia, España. No es un producto genérico — cada decisión responde a las necesidades concretas de este negocio.

**El contexto operativo:**
- Una sola persona maneja caja, producción y stock desde una **tablet Android**
- El local produce sandwiches artesanales cada día (pan de miga, rellenos frescos)
- ~113 sandwiches/día promedio, basado en 18 días de ventas reales (mayo-junio 2026)
- 8 variedades de sandwich + bollería (alfajores, croissants, etc.)
- El sistema reemplazó papel y Excel

---

## 2. Historia y versiones

### v1 (base, funciona en producción)
PWA 100% local en tablet Android. Sin servidor, sin internet requerido. Los datos viven en IndexedDB del navegador. Un HTTP File Server de Android sirve los archivos estáticos.

Registra: ventas (carrito → confirmación → historial), producción diaria, stock de productos terminados, exportación TXT al cierre.

**Limitación crítica de v1:** Los datos solo existen en esa tablet. Si se rompe, se pierde todo.

### v2 (en desarrollo activo, julio 2026)
Misma app, tres mejoras grandes añadidas por capas:

1. **Aprovisionamiento con recetas** ✅ IMPLEMENTADO
2. **Sincronización Supabase (nube)** ✅ IMPLEMENTADO (parcial — ventas, insumos, recetas)
3. **Dashboard del dueño** 🔲 PENDIENTE

---

## 3. Estado actual del código (julio 2026)

### ✅ Módulos implementados y funcionando

| Módulo | Archivo(s) | Estado |
|--------|-----------|--------|
| Caja (ventas) | `business.js`, `render.js` | ✅ Prod, no tocar |
| Producción diaria | `business.js`, `render.js` | ✅ Prod, no tocar |
| Stock productos | `business.js`, `render.js` | ✅ Prod, no tocar |
| Historial ventas | `business.js`, `render.js` | ✅ Prod, no tocar |
| Insumos (stock) | `aprovisionamiento.js`, `render-aprovisionamiento.js` | ✅ Completo |
| Recetas | `aprovisionamiento.js`, `render-aprovisionamiento.js` | ✅ Completo |
| Calibración modelo | `aprovisionamiento.js`, `render-aprovisionamiento.js` | ✅ Completo |
| Lista de compras smart | `aprovisionamiento.js`, `render-aprovisionamiento.js` | ✅ Completo |
| Proveedores CRUD | `proveedores.js`, `render-proveedores.js` | ✅ Completo |
| Sync Supabase | `sync.js`, `supabase.js` | ✅ Ventas + insumos |
| Dashboard dueño | — | 🔲 No empezado |
| Auth Supabase | — | 🔲 No empezado |

### 🔲 Próximos pasos (en orden de prioridad)

1. **Dashboard del dueño** — Vista mobile de solo lectura. El dueño ve desde su teléfono: ventas del día, caja total, alertas de stock crítico, producción cargada. Sin autenticación por ahora (URL privada es suficiente para v2).

2. **Completar sync Supabase** — Faltan proveedores y proveedor_insumos en la nube. Solo existe en IDB local.

3. **Auth básico** — Para que el dueño acceda al dashboard sin estar en la tablet. Supabase Auth con magic link (sin contraseña).

4. **Service Worker inteligente** — El actual cachea agresivamente. Necesita estrategia network-first para el HTML/JS y cache-first para assets.

5. **Export mejorado** — La lista de compras smart ya es exportable como TXT. Mejorar formato y agregar opción WhatsApp (Web Share API).

---

## 4. Stack técnico

| Capa | Tecnología | Notas |
|------|-----------|-------|
| Frontend | Vanilla JS (ES Modules) | Sin framework, sin build step, sin NPM en runtime |
| UI | HTML + CSS puro | Sin Tailwind, sin CSS-in-JS |
| Base de datos local | IndexedDB via wrapper `idb.js` | Offline-first |
| Base de datos nube | Supabase (PostgreSQL) | Free tier, sync asíncrono |
| Hosting | Vercel | Deploy automático desde GitHub |
| Auth | Supabase Auth | Magic link, pendiente |
| Service Worker | Custom | Necesita reescritura |

**Principio fundamental:** Sin dependencias externas en runtime. Todo lo que corre en la tablet tiene que funcionar offline.

---

## 5. Arquitectura de archivos

```
miga-pos-v2/
├── index.html              # Toda la UI estática (un solo archivo HTML)
├── assets/
│   └── css/styles.css      # Todos los estilos (un solo archivo CSS)
├── src/
│   ├── app/
│   │   └── app.js          # Orquestador: state, eventos, routing entre vistas
│   ├── db/
│   │   ├── idb.js          # Wrapper IndexedDB (getAll, getOne, putOne, withStores)
│   │   └── supabase.js     # Cliente Supabase y queries REST
│   ├── modules/
│   │   ├── seed.js         # Datos iniciales + versiones de seed
│   │   ├── business.js     # Lógica ventas, stock, producción (v1, no tocar)
│   │   ├── pricing.js      # Cálculo precios y combos (v1, no tocar)
│   │   ├── backup.js       # Export TXT/JSON del historial
│   │   ├── aprovisionamiento.js  # Insumos, recetas, calibración, lista compras
│   │   ├── proveedores.js  # CRUD proveedores y proveedor_insumos
│   │   └── sync.js         # Cola offline + sync Supabase
│   ├── ui/
│   │   ├── render.js       # Renders de caja, producción, stock, historial (v1)
│   │   ├── render-aprovisionamiento.js  # Renders de insumos, recetas, lista compras
│   │   └── render-proveedores.js        # Renders del módulo proveedores
│   └── utils/
│       └── format.js       # Formateo de moneda, fechas, texto, export
```

**Flujo de datos unidireccional:**
```
seed.js (datos iniciales)
  → idb.js (escritura IDB)
  → módulo de datos (lógica: aprovisionamiento.js / proveedores.js / business.js)
  → app.js (orquestación, state)
  → render-*.js (DOM)
  → sync.js → supabase.js (nube, asíncrono, fire-and-forget)
```

---

## 6. Stores IndexedDB (estado actual)

```
DB_NAME = "miga-pos-local"
DB_VERSION = 10

Stores:
  categorias          — categorías de productos
  productos           — productos con precio y stock
  produccion_diaria   — producción por día y producto
  ventas              — cabecera de cada venta
  detalle_venta       — líneas de venta (producto × cantidad)
  movimientos_stock   — historial de ajustes de stock de productos
  configuracion       — clave-valor para configuración y versiones de seed
  cierres_diarios     — resúmenes diarios
  insumos             — materias primas con stock, mínimos, calibración
  recetas             — qué insumos consume cada producto y en qué cantidad
  movimientos_insumos — historial de consumo/compra de insumos
  historial_calibraciones — log de cada calibración del modelo EMA
  historial_recetas   — log de cambios en cantidades de recetas
  proveedores         — proveedores reales del negocio
  proveedor_insumos   — qué productos vende cada proveedor (precio, unidad, cantidad)
```

---

## 7. Dataset real del negocio

### Insumos (21 activos)

| ID | Nombre | Unidad | Compra | Factor |
|----|--------|--------|--------|--------|
| miga | Miga (pan) | rebanada | paquete | 12 |
| queso-gouda | Queso gouda | g | kg | 1000 |
| jamon-york | Jamon york | g | kg | 1000 |
| jamon-serrano | Jamon serrano | g | kg | 1000 |
| pasta-aceituna | Pasta de aceituna | g | kg | 1000 |
| pimientos-asados | Pimientos asados | g | kg | 1000 |
| pesto | Pesto | g | kg | 1000 |
| tomate | Tomate | g | kg | 1000 |
| palta | Palta | g | kg | 1000 |
| atun | Atun | g | kg | 1000 |
| queso-crema | Queso crema | g | kg | 1000 |
| rucula | Rucula | g | kg | 1000 |
| berenjena | Berenjena asada | g | kg | 1000 |
| queso-brie | Queso brie | g | kg | 1000 |
| mayonesa | Mayonesa | g | kg | 1000 |
| huevo | Huevo | unidad | paquete | 24 |
| cafe | Cafe | g | bolsa | 1000 |
| leche-normal | Leche entera | ml | L | 1000 |
| leche-avena | Leche de avena | ml | L | 1000 |
| leche-sin-lactosa | Leche sin lactosa | ml | L | 1000 |
| dulce-de-leche | Dulce de leche | g | kg | 1000 |

**Nota unidades:** Las unidades son libres, el sistema NO convierte. `factorConversion` es cuántas unidades base hay en una unidad de compra. Para la miga: 1 paquete = 12 rebanadas, entonces `factorConversion = 12`.

### Proveedores (8 activos)

| ID | Nombre | Ciclo | Notas |
|----|--------|-------|-------|
| mercadona | Mercadona | 3d | Online, entrega mart/mier/vier |
| tropicalia | Tropicalia | 7d | Pan miga congelado, repostería argentina |
| reyunos | Los Reyunos | 14d | Pan miga. Más barato que Tropicalia |
| jasa | JASA Alimentacion | 7d | Jamón y congelados. Agente Sara Bonilla |
| kaffetto | Kaffetto Coffee Roasters | 30d | Café specialty |
| makro | Makro (Albuixech) | 14d | Lácteos, siropes, varios |
| delicias-vegetales | Delicias Vegetales | 7d | Verdura ecológica, Orihuela |
| pampa | Pampa Drugstore | 30d | Repostería argentina, Barcelona |

`diasCiclo` es clave para la lista de compras smart: define cada cuántos días se hace pedido y por tanto cuánto stock se necesita cubrir.

### Versiones de seed (crítico para evitar romper IDB)

```js
DB_VERSION = 10              // versión del schema IDB — incrementar solo si cambia estructura de stores
INSUMOS_SEED_VERSION = 6     // incrementar si cambian insumos, stockMinimo, factorConversion
PROVEEDORES_SEED_VERSION = 5 // incrementar si cambian proveedores o proveedor_insumos
```

---

## 8. Patrones de código críticos

### 8.1 `withStores` — NUNCA await dentro del callback

```js
// ✅ CORRECTO — leer fuera, escribir dentro
const insumo = await getOne("insumos", insumoId);
await withStores(["insumos", "movimientos_insumos"], "readwrite", (stores) => {
  stores.insumos.put({ ...insumo, stockActual: nuevoStock });
  stores.movimientos_insumos.add({ insumoId, cantidad, tipo });
});

// ❌ INCORRECTO — await dentro del callback cierra la transacción IDB
await withStores(["insumos"], "readwrite", async (stores) => {
  const insumo = await getOne("insumos", id); // ← ROMPE la transacción
  stores.insumos.put(insumo);
});
```

La excepción es `requestToPromise(stores.X.getAll())` que existe específicamente para leer dentro de transacciones en contextos donde no se puede evitar (ver `deductInsumosInTx`).

### 8.2 Seed no-destructivo

Los seeds NUNCA sobreescriben ediciones del usuario. Solo insertan registros que no existen. Si se necesita actualizar un campo existente (ej: cambió `factorConversion`), se usa `versionDesactualizada` para aplicar una migración controlada:

```js
// En seedInsumos(): cuando INSUMOS_SEED_VERSION sube, actualiza campos técnicos
// pero NO sobrescribe stockActual (el usuario puede haberlo cambiado)
stores.insumos.put({
  ...existing,
  stockMinimo: seedInsumo.stockMinimo,
  stockCritico: seedInsumo.stockCritico,
  factorConversion: seedInsumo.factorConversion,
  unidadCompra: seedInsumo.unidadCompra
});
```

### 8.3 IDs de seed obsoletos

Cuando un registro cambia de ID (ej: se renombra), el viejo ID queda huérfano en IDB. Usar array de obsoletos:

```js
// En seedProveedores():
const piObsoletos = ["jasa:jamon-york"]; // IDs que deben eliminarse
for (const id of piObsoletos) {
  stores.proveedor_insumos.delete(id);
}
```

### 8.4 Sync asíncrono — fire-and-forget

La UI nunca espera a Supabase. Si falla, no bloquea:

```js
// ✅ Patrón correcto
trySyncVenta({ venta, detalles }).catch(() => {});
```

### 8.5 Render functions — innerHTML + event delegation

Las funciones de render generan HTML como strings y usan event delegation con `data-action` attributes. No hay virtual DOM ni reconciliación:

```js
// Ejemplo patrón:
container.innerHTML = items.map(item => `
  <div class="card" data-id="${item.id}">
    <button type="button" data-action="edit" data-id="${item.id}">Editar</button>
  </div>
`).join("");

container.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-action]");
  if (!btn) return;
  if (btn.dataset.action === "edit") onEdit(btn.dataset.id);
});
```

### 8.6 Buttons dentro de forms — siempre `type="button"`

Todo botón que no sea submit dentro de un `<form>` DEBE tener `type="button"`. Sin él, el browser lo trata como submit y ejecuta el formulario al hacer click.

---

## 9. Módulo de calibración del modelo (importante entender)

El sistema aprende cuánto insumo consume realmente cada sandwich mediante calibraciones periódicas:

1. **Receta inicial:** cantidad estimada por unidad (ej: 20g de jamón por sandwich)
2. **Producción descuenta:** cada sandwich producido descuenta según la receta
3. **Calibración:** el usuario cuenta el stock real. El sistema compara stock esperado vs real y calcula un factor de corrección
4. **EMA (Exponential Moving Average):** el factor se suaviza con alpha para no reaccionar exagerado a un día atípico
5. **`alphaReceta`** (0.30/0.60/0.90): qué tan rápido aprende. 0.90 = reactiva (cambia mucho ante cada calibración)
6. **`alphaPrediccion`** (0.20/0.50/0.80): qué tan reciente vs histórico para predecir días de stock restante
7. **`recetaFija: true`:** para recetas donde el consumo es exacto y no debe aprender (ej: miga — siempre 0.5 rebanadas por sandwich)

---

## 10. Lista de compras smart — cómo funciona

La función `listaDeComprasSmart()` en `aprovisionamiento.js`:

1. Calcula `consumoDiario` por EMA de calibraciones históricas
   - Fallback si no hay historial: `stockMinimo / 7` días
2. Para cada proveedor del insumo: calcula cuánto pedir = `consumoDiario × diasCiclo + stockMinimo - stockActual`
   - La cantidad se divide por `pi.cantidadPorUnidad` (unidad del proveedor), NO por `factorConversion`
3. Clasifica urgencia:
   - `urgente`: stockCritico activo O días restantes < días del ciclo del proveedor más rápido
   - `pronto`: stockBajo O días restantes < 1.5× ciclo
   - `ok`: todo bien
4. Elige `mejorSupplier` = el más barato por unidad base (menor `costoPorUnidadBase`)
5. Devuelve `{ items, byProveedor }` para las tres vistas del UI

---

## 11. Roles de agentes especializados

### Agente de Datos (`agente-datos`)
**Ámbito:** `src/db/`, `src/modules/seed.js`, `src/modules/aprovisionamiento.js` (solo funciones de datos), `src/modules/proveedores.js` (solo funciones de datos), `src/modules/sync.js`, `src/db/supabase.js`

**Qué necesita saber:**
- Estructura completa de stores IDB (sección 6)
- Dataset real: insumos, proveedores, versiones de seed (sección 7)
- Patrón `withStores` — nunca await dentro (sección 8.1)
- Seed no-destructivo y IDs obsoletos (secciones 8.2, 8.3)
- Supabase schema (supabase-schema.sql en raíz del proyecto)

**Responsabilidades:**
- Agregar/modificar insumos o proveedores en `seed.js` (siempre bumping la version)
- Queries a Supabase
- Lógica de calibración EMA
- Schema migrations (DB_VERSION y createStores en idb.js)
- Sync offline-first

**No tocar:** Nada de UI, nada de render functions, nada de app.js

---

### Agente de Diseño/Producto (`agente-ui`)
**Ámbito:** `index.html`, `assets/css/styles.css`, `src/ui/render-*.js`

**Qué necesita saber:**
- Dispositivo principal: **tablet Android** en posición vertical (~768px)
- Usuario operativo: persona no técnica en caja, con prisa, sin errores permitidos
- Tap targets mínimo: **48px** de área táctil
- Paleta de colores definida en `:root` de `styles.css`:
  - `--ink` #17202a (texto), `--muted` #607080 (secundario), `--surface` #ffffff, `--page` #f4f7f6
  - `--primary` #17324d (acción principal), `--accent` #d64b2a (rojo/alerta)
  - `--ok` #20734d (verde), `--low` #a26400 (amarillo/bajo), `--out` #a32020 (rojo/crítico)
- Las sheets/modales usan clases: `.production-sheet`, `.stock-adjust-sheet`, backdrop + `.open` toggle
- **Buttons dentro de forms**: siempre `type="button"` excepto el submit (sección 8.6)
- Los renders generan HTML strings, no hay componentes. Event delegation con `data-action`

**Responsabilidades:**
- Layouts, spacing, tipografía
- Bottom sheets y modales
- Estado visual: pills de stock (OK/Bajo/Crítico), badges de urgencia
- Responsive para tablet

**No tocar:** Lógica de negocio, funciones de datos, seed

---

### Agente de Lógica/Programación (`agente-logica`)
**Ámbito:** `src/app/app.js`, `src/modules/business.js`, `src/modules/pricing.js`, `src/modules/backup.js`, lógica en `aprovisionamiento.js` y `proveedores.js`

**Qué necesita saber:**
- `app.js` es el orquestador: state global, event listeners, routing entre vistas, conecta todo
- Patrón de vistas: `showView(viewName)` → `refreshView(viewName)` → función específica de render
- State variables por módulo: `selectedInsumoId`, `selectedProvId`, `provProdMode`, etc.
- Las sheets se abren/cierran con `setXxxSheetOpen(bool)` — siempre actualizar el `aria-hidden`
- El modelo de calibración EMA vive en `aprovisionamiento.js` — no duplicar esa lógica en app.js
- `business.js` es código v1 probado en producción — modificar con extrema cautela, preferir extensión

**Responsabilidades:**
- Event handlers nuevos en app.js
- Integración de nuevos módulos de datos en el ciclo de render
- Lógica de combos y precios
- Export y backup

**No tocar:** Estructura de stores IDB, seeds, CSS puro

---

## 12. Criterios de diseño que no negociar

1. **Sin fricción en caja:** cada acción tiene que ser 1-2 taps. La persona que cobra no puede cometer errores de UI.
2. **Offline primero:** la app funciona sin WiFi. Sync es bonus, no requisito.
3. **Sin dependencias en runtime:** Vanilla JS, sin CDN, sin frameworks. Menos cosas que romper.
4. **Sin costo:** free tiers de Supabase + Vercel son suficientes para años de crecimiento del negocio.
5. **Datos del usuario son sagrados:** el seed nunca sobreescribe lo que el usuario editó.
6. **Feedback inmediato:** toda acción devuelve un flash message. Nunca silencio tras un tap.

---

## 13. Lo que NO hacer

- **No usar `await` dentro de `withStores()`** — rompe la transacción IDB silenciosamente
- **No agregar frameworks** (React, Vue, etc.) — el costo en complejidad no vale para este proyecto
- **No agregar NPM dependencies en runtime** — tiene que funcionar sin node_modules
- **No sobreescribir stockActual del usuario en el seed** — los datos reales son del usuario, no del seed
- **No bloquear la caja esperando Supabase** — sync siempre fire-and-forget con `.catch(() => {})`
- **No hacer botones sin `type="button"` dentro de forms** — submitea el form accidentalmente
- **No cambiar DB_VERSION sin agregar el store en `createStores()`** — el upgrade IDB falla silenciosamente
- **No modificar `business.js` sin entender el efecto en cadena** — es código v1 en producción

---

## 14. Crecimiento del proyecto — visión

**Corto plazo (próximas semanas):**
- Completar sync de proveedores a Supabase
- Auth magic link para acceso del dueño

**Mediano plazo:**
- Histórico de precios por proveedor (para detectar subidas)
- Alertas push cuando stock cae a crítico (Web Push API)
- Módulo de costos: cuánto cuesta producir cada sandwich (receta × precio insumo)

**Largo plazo (si el negocio escala):**
- Segunda sucursal: misma app, diferente instancia Supabase o RLS por local
- Panel de analytics para el dueño (ventas semanales, top productos, margen bruto)
- Integración con TPV físico o código QR para pedidos online

**Principio de escalado:** La arquitectura aguanta todo esto sin reescribir. Se agregan módulos, stores y vistas. El core (caja, producción, stock) no cambia.
