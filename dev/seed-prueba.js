/**
 * dev/seed-prueba.js — Dataset de prueba para calibración ML de Miga POS
 *
 * Simula 4 semanas de operación con convergencia diferente por insumo.
 * Prerequisito: abrir la app principal primero (http://localhost:8080) para
 * que los stores de IDB existan y los insumos/recetas estén sembrados.
 */

const DB_NAME = "miga-pos-local";
const TAG = "seed-prueba-v2";

// ---------------------------------------------------------------------------
// IDB helpers — solo lectura fuera de transacciones activas
// ---------------------------------------------------------------------------
function openDB() {
  // Sin número de versión → abre la DB al nivel que ya existe.
  // Si se pasara un número distinto al real, dispararía onupgradeneeded
  // (sin handler) y la DB quedaría vacía.
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror  = () => reject(tx.error);
    tx.onabort  = () => reject(new Error("Transacción cancelada."));
  });
}
function getAll(db, storeName) {
  return new Promise((res, rej) => {
    const r = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// ---------------------------------------------------------------------------
// Datos de negocio
// ---------------------------------------------------------------------------
const PROPS = {
  "jamon-queso":          0.336,
  "jamon-serrano-rucula": 0.116,
  "huevo-jamon":          0.102,
  "pesto-tomate-queso":   0.083,
  "especial-semanal":     0.078,
  "pasta-oliva-queso":    0.080,
  "pimiento-gouda-philp": 0.077,
  "atun-palta-queso":     0.083,
  "berenjena-brie":       0.039,
  "huevo-queso":          0.006,
  // Café — proporción de unidades/día respecto a 113 unidades base
  "expresso-30ml":        0.044,
  "cortado":              0.027,
  "latte":                0.035,
  "cafe-con-leche":       0.053,
  "promo-cafe-con-leche": 0.035,
  "capuccino":            0.027,
  "americano":            0.018,
  "flat-white":           0.018,
  "ice-latte":            0.018,
  "ice-caramel":          0.009,
  "mini-croissant-ddl":   0.027,
};

const RECETAS_INSUMOS = {
  "miga":             ["jamon-queso","jamon-serrano-rucula","huevo-jamon","pesto-tomate-queso","especial-semanal","pasta-oliva-queso","pimiento-gouda-philp","atun-palta-queso","berenjena-brie","huevo-queso"],
  "queso-gouda":      ["jamon-queso","pasta-oliva-queso","pimiento-gouda-philp","pesto-tomate-queso","jamon-serrano-rucula","atun-palta-queso","huevo-queso"],
  "jamon-york":       ["jamon-queso","huevo-jamon"],
  "jamon-serrano":    ["jamon-serrano-rucula"],
  "pasta-aceituna":   ["pasta-oliva-queso"],
  "pimientos-asados": ["pimiento-gouda-philp"],
  "pesto":            ["pesto-tomate-queso"],
  "tomate":           ["pesto-tomate-queso"],
  "palta":            ["atun-palta-queso"],
  "atun":             ["atun-palta-queso"],
  "queso-crema":      ["pimiento-gouda-philp"],
  "rucula":           ["jamon-serrano-rucula"],
  "berenjena":        ["berenjena-brie"],
  "queso-brie":       ["berenjena-brie"],
  "mayonesa":         ["jamon-queso","jamon-serrano-rucula","huevo-jamon","pesto-tomate-queso","especial-semanal","pasta-oliva-queso","pimiento-gouda-philp","atun-palta-queso","berenjena-brie","huevo-queso"],
  "huevo":            ["huevo-jamon","huevo-queso"],
  "cafe":             ["expresso-30ml","cortado","latte","cafe-con-leche","promo-cafe-con-leche","capuccino","americano","flat-white","ice-latte","ice-caramel"],
  "leche-normal":     ["cortado","latte","cafe-con-leche","promo-cafe-con-leche","capuccino","flat-white","ice-latte","ice-caramel"],
  "dulce-de-leche":   ["mini-croissant-ddl"],
};

const SEED_RECIPE = {
  "miga":0.5, "queso-gouda":25, "jamon-york":33, "jamon-serrano":20,
  "pasta-aceituna":33, "pimientos-asados":33, "pesto":23, "tomate":30,
  "palta":27, "atun":33, "queso-crema":20, "rucula":10,
  "berenjena":27, "queso-brie":20, "mayonesa":5, "huevo":1,
  // Café — confirmado 10g/shot. Leche: promedio ponderado por mix de bebidas (~168ml). DDL estimado.
  "cafe":10, "leche-normal":168, "dulce-de-leche":20,
};

// Factor observado por insumo en cada calibración (consumoReal / consumoEsperado)
// Cada insumo tiene un escenario de vida diferente.
// El ajuste se aplica cuando |consumoReal - consumoEsperado| > 100 (unidades del insumo).
const CONVERGENCIA = {
  // Cook 1 perfecto → Cook 2 pone 39g (+18%, ajusta 33→36g) → Cook 1 vuelve (sin ajuste)
  // → Cook 3 pone 40g + desperdicio (44% más, ajusta 36→40g)
  "jamon-york":       [1.00, 1.182, 1.00, 1.444],

  // OK → fiambrería empieza a cortar más grueso (+35%, ajusta) → sobre-corrige fino (-25%, ajusta)
  // → se estabiliza levemente arriba (+15%, ajusta)
  "queso-gouda":      [1.00, 1.35, 0.75, 1.15],

  // Receta original MUY subestimada (debería ser ~39g, no 20g) → corrección rápida en 2 semanas
  // sem1: +100% → ajusta 20→37g / sem2: +10% → ajusta 37→38.9g / sem3-4: calibrado
  "queso-crema":      [2.00, 1.10, 1.00, 1.00],

  // miga estable 3 semanas (diff < 100 planchas → sin ajuste) → sem4: nuevo proveedor
  // planchas más grandes pero + desperdicio → 40% más consumido → ajusta 0.5→0.55 planchas
  "miga":             [1.05, 1.00, 1.10, 1.40],

  // mayo OK → alguien empieza a echar muy generoso (+50%, ajusta 5→6.25g)
  // → sobre-corrige hacia abajo (-20%, ajusta 6.25→5.84g) → estabiliza (+10%, ajusta 5.84→5.99g)
  "mayonesa":         [1.00, 1.50, 0.80, 1.10],

  // Rúcula: manojos grandes → uso excesivo (+80%, ajusta 10→16.8g)
  // → mejora pero sigue alta (+30%, ajusta 16.8→19.3g) → OK (sin ajuste)
  // → proveedor cambia, hojas pequeñas → se usa menos (-15%, ajusta 19.3→18.6g)
  "rucula":           [1.80, 1.30, 1.00, 0.85],

  // OK → nuevo cocinero corta lonjas gruesas (+60%, ajusta 20→26g)
  // → se le dijo que corte fino (-25%, ajusta 26→23.9g) → estabiliza (+20%, ajusta 23.9→25.1g)
  "jamon-serrano":    [1.00, 1.60, 0.75, 1.20],

  // pasta-aceituna OK 2 semanas → sem3: nuevo proveedor, pasta más concentrada
  // se usa -50% de cantidad → detectado, ajusta 33→27.6g → sem4 OK con nueva receta
  "pasta-aceituna":   [1.00, 1.00, 0.50, 1.00],

  // Receta inicial subestimada (+60%, ajusta 33→49.8g en sem1) → estable 2 semanas
  // → sem4: leve bajada por cambio en tamaño de frasco (-10%, ajusta 49.8→48.6g)
  "pimientos-asados": [1.60, 1.00, 1.00, 0.90],

  // pesto OK → sem2: frasco de pesto rinde menos por lote (+50%, ajusta 23→28.75g)
  // → sem3 OK (sin ajuste) → sem4: cantidad sigue subiendo (+30%, ajusta 28.75→30.9g)
  "pesto":            [1.00, 1.50, 1.00, 1.30],

  // tomate OK → sem2: semana de tomates gigantes, se usan menos láminas (-30%, ajusta 30→25.5g)
  // → sem3: tomates chicos, se usan más (+40%, ajusta 25.5→28.9g) → sem4 OK (sin ajuste)
  "tomate":           [1.00, 0.70, 1.40, 1.00],

  // Receta inicial muy baja (27g) → paltas grandes + desperdicio (+80%, ajusta 27→37.8g)
  // → sigue alta (+30%, ajusta 37.8→41.5g) → sem4 OK, estabilizado en 41.5g
  "palta":            [1.00, 1.80, 1.30, 1.00],

  // atún estable 3 semanas → sem4: nuevo empleado empieza a poner más tuna (+45%, ajusta 33→36.7g)
  "atun":             [1.00, 1.00, 1.00, 1.45],

  // berenjena: receta muy baja (27g → real ~45g) → ajusta en 2 semanas
  // → sem3: proveedor cambia, berenjenas más pequeñas (-35%, ajusta 47.4→41.9g) → sem4 OK
  "berenjena":        [1.70, 1.20, 0.65, 1.00],

  // brie OK → sem2: porciones más generosas (+55%, ajusta 20→25.5g) → sem3-4 estable
  "queso-brie":       [1.00, 1.55, 1.00, 1.00],

  // huevo: stable → sem2 alguien usa 1.5 huevos/sw promedio (mezcla de 1 y 2) → baja → sube leve
  // modelo ajusta a 1.25 → 1.17 → 1.23 huevos/sw (promedio real entre cocineros)
  "huevo":            [1.00, 1.50, 0.80, 1.20],

  // café: OK sem1 → barista empieza a presionar más el portafilter (+20%) → sem3 sigue
  // → sem4 nuevo barista más preciso, baja levemente (-5%)
  "cafe":             [1.00, 1.20, 1.20, 0.95],

  // leche: espumado genera mucho desperdicio, difícil de estimar (+40% sem1)
  // → sem2 calibra → sem3 verano: bebidas con más leche por calor (+60%) → sem4 baja (-15%)
  "leche-normal":     [1.40, 1.00, 1.60, 0.85],

  // dulce de leche: receta inicial muy subestimada (real ~46g no 20g) → 2 ajustes rápidos → estable
  "dulce-de-leche":   [2.00, 1.20, 1.00, 1.10],
};

const INSUMO_IDS = Object.keys(CONVERGENCIA);

const SEMANAS = [
  {
    calDate: "2026-05-18", compraDate: "2026-05-18",
    diasVentas: {
      "jamon-queso":98,"jamon-serrano-rucula":34,"huevo-jamon":30,"pesto-tomate-queso":24,"especial-semanal":23,"pasta-oliva-queso":23,"pimiento-gouda-philp":22,"atun-palta-queso":24,"berenjena-brie":11,"huevo-queso":2,
      "expresso-30ml":25,"cortado":15,"latte":20,"cafe-con-leche":30,"promo-cafe-con-leche":20,"capuccino":15,"americano":10,"flat-white":10,"ice-latte":5,"ice-caramel":3,"mini-croissant-ddl":20,
    },
  },
  {
    calDate: "2026-05-25", compraDate: "2026-05-25",
    diasVentas: {
      "jamon-queso":141,"jamon-serrano-rucula":49,"huevo-jamon":43,"pesto-tomate-queso":35,"especial-semanal":33,"pasta-oliva-queso":34,"pimiento-gouda-philp":32,"atun-palta-queso":35,"berenjena-brie":16,"huevo-queso":1,
      "expresso-30ml":36,"cortado":21,"latte":29,"cafe-con-leche":43,"promo-cafe-con-leche":29,"capuccino":21,"americano":14,"flat-white":14,"ice-latte":7,"ice-caramel":4,"mini-croissant-ddl":29,
    },
  },
  {
    calDate: "2026-06-01", compraDate: "2026-06-01",
    diasVentas: {
      "jamon-queso":128,"jamon-serrano-rucula":44,"huevo-jamon":39,"pesto-tomate-queso":32,"especial-semanal":30,"pasta-oliva-queso":31,"pimiento-gouda-philp":29,"atun-palta-queso":32,"berenjena-brie":15,"huevo-queso":2,
      "expresso-30ml":33,"cortado":19,"latte":26,"cafe-con-leche":39,"promo-cafe-con-leche":26,"capuccino":19,"americano":13,"flat-white":13,"ice-latte":7,"ice-caramel":4,"mini-croissant-ddl":26,
    },
  },
  {
    calDate: "2026-06-15", compraDate: "2026-06-15",
    diasVentas: {
      "jamon-queso":250,"jamon-serrano-rucula":86,"huevo-jamon":76,"pesto-tomate-queso":62,"especial-semanal":58,"pasta-oliva-queso":59,"pimiento-gouda-philp":57,"atun-palta-queso":62,"berenjena-brie":29,"huevo-queso":4,
      "expresso-30ml":65,"cortado":39,"latte":52,"cafe-con-leche":78,"promo-cafe-con-leche":52,"capuccino":39,"americano":26,"flat-white":26,"ice-latte":13,"ice-caramel":8,"mini-croissant-ddl":52,
    },
  },
];

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function r4(n) { return parseFloat(n.toFixed(4)); }

// ---------------------------------------------------------------------------
// seedDatosPrueba
// ---------------------------------------------------------------------------
export async function seedDatosPrueba() {
  const db = await openDB();

  // Si la DB está vacía (migración corrupta), borrarla y pedir que recarguen la app
  if (db.objectStoreNames.length === 0) {
    db.close();
    await new Promise((res, rej) => {
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onsuccess = res;
      del.onerror   = () => rej(del.error);
    });
    throw new Error("La DB estaba vacía (migración fallida). Ya la eliminé. Ahora: 1) Recargá la pestaña de Miga POS (Ctrl+Shift+R), 2) Volvé acá y apretá el botón de nuevo.");
  }

  for (const s of ["insumos","recetas","movimientos_insumos","historial_calibraciones"]) {
    if (!db.objectStoreNames.contains(s)) {
      throw new Error(`Store "${s}" no existe. Abrí la app principal primero (debe mostrar insumos en la pestaña).`);
    }
  }

  // ---- Leer TODA la data upfront (fuera de transacciones) ----------------
  const insumosActuales = await getAll(db, "insumos");
  const recetasActuales = await getAll(db, "recetas");

  const insumoMap = new Map(insumosActuales.map(i => [i.id, i]));
  const faltantes = INSUMO_IDS.filter(id => !insumoMap.has(id));
  if (faltantes.length > 0) throw new Error(`Insumos no encontrados en IDB: ${faltantes.join(", ")}`);

  // Estado mutable de la simulación (se actualiza entre semanas)
  const currentRecipe = { ...SEED_RECIPE };
  const currentStock  = {};

  // -------------------------------------------------------------------------
  // PASO 1 — Stock inicial (14-may-2026)
  // -------------------------------------------------------------------------
  {
    const AVG = 113;
    const ops = INSUMO_IDS.map(id => {
      const propSum = (RECETAS_INSUMOS[id] || []).reduce((s, p) => s + (PROPS[p] || 0), 0);
      const stockNuevo = Math.round(AVG * propSum * SEED_RECIPE[id] * 4);
      const insumo = insumoMap.get(id);
      currentStock[id] = stockNuevo;
      return { id, insumo, stockNuevo };
    });

    const tx = db.transaction(["insumos","movimientos_insumos"], "readwrite");
    const insStore = tx.objectStore("insumos");
    const movStore = tx.objectStore("movimientos_insumos");
    const fecha = "2026-05-14";

    for (const { id, insumo, stockNuevo } of ops) {
      movStore.add({ insumoId:id, tipo:"ajuste_manual",
        cantidad: stockNuevo - insumo.stockActual,
        stockAnterior: insumo.stockActual, stockNuevo, fecha,
        tag:TAG, creadoEn:`${fecha}T08:00:00.000Z` });
      insStore.put({ ...insumo, stockActual:stockNuevo, actualizadoEn:`${fecha}T08:00:00.000Z` });
      insumoMap.set(id, { ...insumo, stockActual:stockNuevo });
    }
    await txDone(tx);
    console.log("[seed] Stock inicial cargado.");
  }

  // -------------------------------------------------------------------------
  // PASOS 2-5 — Por cada semana: compra + calibración
  // -------------------------------------------------------------------------
  for (let calIdx = 0; calIdx < SEMANAS.length; calIdx++) {
    const semana  = SEMANAS[calIdx];
    const alpha   = r4(Math.min(0.85, Math.max(0.80, 1 / (calIdx + 1))));
    const AVG     = 113;

    // --- Compra semanal ---
    {
      const compraOps = INSUMO_IDS.map(id => {
        const propSum  = (RECETAS_INSUMOS[id] || []).reduce((s, p) => s + (PROPS[p] || 0), 0);
        const cantidad = Math.round(AVG * propSum * currentRecipe[id] * 10);
        const stockAnterior = currentStock[id];
        const stockNuevo    = stockAnterior + cantidad;
        currentStock[id]    = stockNuevo;
        return { id, cantidad, stockAnterior, stockNuevo };
      });

      const tx = db.transaction(["insumos","movimientos_insumos"], "readwrite");
      const insStore = tx.objectStore("insumos");
      const movStore = tx.objectStore("movimientos_insumos");

      for (const { id, cantidad, stockAnterior, stockNuevo } of compraOps) {
        const insumo = insumoMap.get(id);
        movStore.add({ insumoId:id, tipo:"compra", cantidad, stockAnterior, stockNuevo,
          fecha:semana.compraDate, tag:TAG, creadoEn:`${semana.compraDate}T08:30:00.000Z` });
        insStore.put({ ...insumo, stockActual:stockNuevo, actualizadoEn:`${semana.compraDate}T08:30:00.000Z` });
        insumoMap.set(id, { ...insumo, stockActual:stockNuevo });
      }
      await txDone(tx);
      console.log(`[seed] Compra semana ${calIdx+1} (${semana.compraDate}).`);
    }

    // --- Calibración: calcular todo ANTES de abrir la transacción ---
    const calOps = [];
    for (const id of INSUMO_IDS) {
      const factorObs   = CONVERGENCIA[id][calIdx];
      const sandwiches  = (RECETAS_INSUMOS[id] || []).reduce((s, p) => s + (semana.diasVentas[p] || 0), 0);
      if (sandwiches === 0) continue;

      const consumoEsperado = r4(sandwiches * currentRecipe[id]);
      const consumoReal     = r4(consumoEsperado * factorObs);
      const buffer          = r4(consumoEsperado * 0.30);
      const stockAntes      = r4(consumoReal + buffer);
      const stockReal       = buffer;

      const factorClamped   = r4(clamp(factorObs, 0.5, 2.0));
      const estimadoAntes   = currentRecipe[id];
      // Sin umbral — siempre calibra. Si factor=1.0 exacto, la fórmula devuelve lo mismo.
      const estimadoDespues = r4(estimadoAntes * (alpha * factorClamped + (1 - alpha)));
      const ajusteAplicado  = estimadoDespues !== estimadoAntes;

      const ventasPorProducto = {};
      for (const p of (RECETAS_INSUMOS[id] || [])) {
        if (semana.diasVentas[p]) ventasPorProducto[p] = semana.diasVentas[p];
      }

      // Recetas a actualizar (filtradas de la lista leída upfront)
      const recetasDelInsumo = recetasActuales.filter(r => r.insumoId === id);

      calOps.push({
        id, sandwiches, consumoEsperado, consumoReal,
        stockAntes, stockReal,
        factorObs, factorClamped, alpha,
        estimadoAntes, estimadoDespues, ajusteAplicado,
        ventasPorProducto,
        recetasDelInsumo,
        stockAnteriorMov: currentStock[id],
      });

      // Actualizar estado para siguiente semana
      currentStock[id]  = stockReal;
      const esFijaLocal = recetasActuales.some(r => r.insumoId === id && r.recetaFija);
      if (!esFijaLocal) currentRecipe[id] = estimadoDespues;
    }

    // --- Escritura en una sola transacción, sin awaits intermedios ---
    const tx = db.transaction(["insumos","recetas","movimientos_insumos","historial_calibraciones"], "readwrite");
    const insStore = tx.objectStore("insumos");
    const recStore = tx.objectStore("recetas");
    const movStore = tx.objectStore("movimientos_insumos");
    const calStore = tx.objectStore("historial_calibraciones");

    for (const op of calOps) {
      const esFija = op.recetasDelInsumo.some(r => r.recetaFija);
      calStore.add({
        insumoId: op.id, fecha: semana.calDate,
        stockAntes: op.stockAntes, stockReal: op.stockReal,
        sandwiches: op.sandwiches,
        consumoEsperado: op.consumoEsperado, consumoReal: op.consumoReal,
        factorObservado: r4(op.factorObs), factorClamped: op.factorClamped,
        alphaUsado: esFija ? 0 : op.alpha,
        estimadoAntes: op.estimadoAntes,
        estimadoDespues: esFija ? op.estimadoAntes : op.estimadoDespues,
        ajusteAplicado: esFija ? false : op.ajusteAplicado,
        ...(esFija ? { recetaFija: true } : {}),
        tag: TAG, creadoEn: `${semana.calDate}T10:00:00.000Z`,
      });

      movStore.add({
        insumoId: op.id, tipo:"calibracion",
        cantidad: r4(op.stockReal - op.stockAnteriorMov),
        stockAnterior: op.stockAnteriorMov, stockNuevo: op.stockReal,
        fecha: semana.calDate, tag:TAG, creadoEn:`${semana.calDate}T10:00:00.000Z`,
      });

      if (op.ajusteAplicado) {
        for (const rec of op.recetasDelInsumo) {
          if (rec.recetaFija) continue;
          recStore.put({ ...rec, cantidadPorUnidad: op.estimadoDespues,
            esEstimado:true, actualizadoEn:`${semana.calDate}T10:00:00.000Z` });
        }
      }

      const insumo = insumoMap.get(op.id);
      insStore.put({
        ...insumo,
        stockActual: op.stockReal,
        necesitaCalibracion: false,
        ultimaCalibracion: {
          fecha: `${semana.calDate}T10:00:00.000Z`,
          stockEnCalibracion: op.stockReal,
          ventasPorProducto: op.ventasPorProducto,
        },
        actualizadoEn: `${semana.calDate}T10:00:00.000Z`,
      });
      insumoMap.set(op.id, {
        ...insumo,
        stockActual: op.stockReal,
        necesitaCalibracion: false,
        ultimaCalibracion: {
          fecha: `${semana.calDate}T10:00:00.000Z`,
          stockEnCalibracion: op.stockReal,
          ventasPorProducto: op.ventasPorProducto,
        },
        actualizadoEn: `${semana.calDate}T10:00:00.000Z`,
      });
    }

    await txDone(tx);
    console.log(`[seed] Calibración ${semana.calDate} ok (semana ${calIdx+1}, α=${alpha}).`);
  }

  // -------------------------------------------------------------------------
  // PASO 6 — Semana actual: compra + 17 días de consumo SIN calibrar
  // Nos paramos en 2026-07-02 listos para hacer el conteo real.
  // La última calibración fue 2026-06-15 → "Hace 17 días" en el dashboard.
  // -------------------------------------------------------------------------
  {
    const AVG         = 113;
    const DIAS_ACTUAL = 17;
    const semana4     = SEMANAS[3];
    const compraDate  = "2026-06-16";
    const consumoDate = "2026-07-01"; // cierre del período antes de calibrar

    const paso6Ops = INSUMO_IDS.map(id => {
      // Primero: consumo estimado de 17 días (proporcional a semana 4)
      const ventasPorProducto = {};
      let sandwiches = 0;
      for (const p of (RECETAS_INSUMOS[id] || [])) {
        const qty = Math.round((semana4.diasVentas[p] || 0) * DIAS_ACTUAL / 7);
        if (qty > 0) { ventasPorProducto[p] = qty; sandwiches += qty; }
      }
      const consumoEstimado = parseFloat((sandwiches * currentRecipe[id]).toFixed(1));

      // Compra = 1.5× el consumo esperado → queda ~50% al llegar a calibrar
      const cantidadCompra = Math.max(1, Math.round(consumoEstimado * 1.5));
      const stockAntesCompra   = currentStock[id];
      const stockDespuesCompra = stockAntesCompra + cantidadCompra;
      const stockFinal         = parseFloat((stockDespuesCompra - consumoEstimado).toFixed(1));

      currentStock[id] = stockFinal;
      return { id, cantidadCompra, stockAntesCompra, stockDespuesCompra, sandwiches, ventasPorProducto, consumoEstimado, stockFinal };
    });

    const tx = db.transaction(["insumos","movimientos_insumos"], "readwrite");
    const insStore = tx.objectStore("insumos");
    const movStore = tx.objectStore("movimientos_insumos");

    for (const op of paso6Ops) {
      const insumo = insumoMap.get(op.id);

      movStore.add({ insumoId:op.id, tipo:"compra", cantidad:op.cantidadCompra,
        stockAnterior:op.stockAntesCompra, stockNuevo:op.stockDespuesCompra,
        fecha:compraDate, tag:TAG, creadoEn:`${compraDate}T08:30:00.000Z` });

      if (op.sandwiches > 0) {
        movStore.add({ insumoId:op.id, tipo:"venta", cantidad:-op.consumoEstimado,
          stockAnterior:op.stockDespuesCompra, stockNuevo:op.stockFinal,
          fecha:consumoDate, tag:TAG, creadoEn:`${consumoDate}T18:00:00.000Z` });
      }

      // Mantener ultimaCalibracion.fecha = 2026-06-15 → "Hace 17 días" en el dashboard.
      // stockEnCalibracion = stockFinal (stock estimado ahora) → baseline correcto para
      // que consumoReal = stockFinal - lo_que_cuentes, sin importar compras pasadas.
      // ventasPorProducto vacío → lo que vos produzcas es lo único que calibra.
      const ultimaCalibracion = {
        ...insumo.ultimaCalibracion,
        stockEnCalibracion: op.stockFinal,
        ventasPorProducto: {},
      };

      insStore.put({
        ...insumo,
        stockActual: op.stockFinal,
        ultimaCalibracion,
        necesitaCalibracion: op.stockFinal <= insumo.stockMinimo,
        actualizadoEn: `${consumoDate}T18:00:00.000Z`,
      });
    }

    await txDone(tx);
    console.log(`[seed] Semana actual cargada: ${DIAS_ACTUAL} días de consumo sin calibrar.`);
  }

  console.log("[seed] ✓ Listo. Estás en 2026-07-02, día de calibración. Abrí Calibrar.");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// resetProduccionHoy — borra la producción y calibraciones de hoy,
// restaura el stock de insumos al estado del seed (PASO 6).
// ---------------------------------------------------------------------------
export async function resetProduccionHoy() {
  const db = await openDB();
  const today = new Date().toISOString().split("T")[0]; // "2026-07-02"

  const [insumosAll, productosAll, produccionAll, movInsumosAll, histCalAll] = await Promise.all([
    getAll(db, "insumos"),
    getAll(db, "productos"),
    getAll(db, "produccion_diaria"),
    getAll(db, "movimientos_insumos"),
    getAll(db, "historial_calibraciones"),
  ]);

  // Entradas de hoy generadas por el usuario (sin tag del seed)
  const hoyProduccion = produccionAll.filter(p => p.fecha === today);
  const hoyMovInsumos = movInsumosAll.filter(m => m.creadoEn?.startsWith(today) && m.tag !== TAG);
  const hoyHistCal    = histCalAll.filter(h => h.creadoEn?.startsWith(today) && h.tag !== TAG);

  // Último movimiento del seed por insumo → stockNuevo es el stockFinal del PASO 6
  const seedFinalByInsumo = {};
  for (const m of movInsumosAll) {
    if (m.tag === TAG) {
      const cur = seedFinalByInsumo[m.insumoId];
      if (!cur || m.creadoEn > cur.creadoEn) seedFinalByInsumo[m.insumoId] = m;
    }
  }

  // Última calibración del seed por insumo → para restaurar ultimaCalibracion.fecha
  const seedLastCalByInsumo = {};
  for (const h of histCalAll) {
    if (h.tag === TAG) {
      const cur = seedLastCalByInsumo[h.insumoId];
      if (!cur || h.creadoEn > cur.creadoEn) seedLastCalByInsumo[h.insumoId] = h;
    }
  }

  // Delta de stock de productos a revertir (la producción suma; acá restamos)
  const productoStockDelta = {};
  for (const p of hoyProduccion) {
    productoStockDelta[p.productoId] = (productoStockDelta[p.productoId] || 0) - (p.cantidad || 0);
  }

  const now = new Date().toISOString();

  // Escribir todo sin awaits intermedios
  const tx = db.transaction(
    ["produccion_diaria", "movimientos_insumos", "historial_calibraciones", "insumos", "productos"],
    "readwrite"
  );
  const prodDiariaStore = tx.objectStore("produccion_diaria");
  const movInsumosStore = tx.objectStore("movimientos_insumos");
  const histCalStore    = tx.objectStore("historial_calibraciones");
  const insumosStore    = tx.objectStore("insumos");
  const productosStore  = tx.objectStore("productos");

  for (const p of hoyProduccion) prodDiariaStore.delete(p.id);
  for (const m of hoyMovInsumos) movInsumosStore.delete(m.id);
  for (const h of hoyHistCal)    histCalStore.delete(h.id);

  for (const insumo of insumosAll) {
    const seedMov = seedFinalByInsumo[insumo.id];
    if (!seedMov) continue;
    const seedStock = seedMov.stockNuevo;

    // Si el usuario calibró hoy, restaurar fecha de última calibración desde el seed
    const existingCal = insumo.ultimaCalibracion;
    const userCalibratedToday = existingCal?.fecha?.startsWith(today);
    const calFecha = userCalibratedToday
      ? (seedLastCalByInsumo[insumo.id]?.creadoEn ?? existingCal?.fecha)
      : existingCal?.fecha;

    insumosStore.put({
      ...insumo,
      stockActual: seedStock,
      necesitaCalibracion: seedStock <= insumo.stockMinimo,
      ultimaCalibracion: {
        fecha: calFecha,
        stockEnCalibracion: seedStock,
        ventasPorProducto: {},
      },
      actualizadoEn: now,
    });
  }

  for (const producto of productosAll) {
    const delta = productoStockDelta[producto.id] || 0;
    if (delta !== 0) {
      productosStore.put({
        ...producto,
        stockActual: Math.max(0, (producto.stockActual || 0) + delta),
        actualizadoEn: now,
      });
    }
  }

  await txDone(tx);
  console.log(`[reset] ✓ Producción de hoy borrada: ${hoyProduccion.length} prod, ${hoyMovInsumos.length} mov insumos, ${hoyHistCal.length} calibraciones. ${Object.keys(seedFinalByInsumo).length} insumos restaurados.`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// clearDatosPrueba
// ---------------------------------------------------------------------------
export async function clearDatosPrueba() {
  const db = await openDB();
  const now = new Date().toISOString();

  // Borra TODO el historial de calibraciones y movimientos de insumos
  // (sin filtrar por TAG para limpiar runs anteriores sin tag)
  for (const storeName of ["movimientos_insumos","historial_calibraciones"]) {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    await txDone(tx);
    console.log(`[clear] ${storeName} vaciado.`);
  }

  // Resetear insumos
  const insumos = await getAll(db, "insumos");
  const txI = db.transaction("insumos", "readwrite");
  const insStore = txI.objectStore("insumos");
  for (const i of insumos) {
    if (INSUMO_IDS.includes(i.id)) {
      insStore.put({ ...i, stockActual:0, necesitaCalibracion:false, ultimaCalibracion:null, actualizadoEn:now });
    }
  }
  await txDone(txI);

  // Resetear recetas a valores del seed
  const recetas = await getAll(db, "recetas");
  const txR = db.transaction("recetas", "readwrite");
  const recStore = txR.objectStore("recetas");
  for (const rec of recetas) {
    if (SEED_RECIPE[rec.insumoId] !== undefined) {
      recStore.put({ ...rec, cantidadPorUnidad: SEED_RECIPE[rec.insumoId], esEstimado: !rec.recetaFija, actualizadoEn:now });
    }
  }
  await txDone(txR);

  console.log("[clear] ✓ Listo.");
  return { ok: true };
}
