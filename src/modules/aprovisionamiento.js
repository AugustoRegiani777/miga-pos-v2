import { getAll, countAll, withStores, requestToPromise } from "../db/idb.js";
import { todayISO, slugify } from "../utils/format.js";
import { initialInsumos, initialRecetas, INSUMOS_SEED_VERSION, INSUMOS_OBSOLETOS_NOMBRES } from "./seed.js";
import { trySyncCalibracion, trySyncInsumosSnapshot, trySyncRecetasSnapshot, trySyncHistorialReceta, getPendingSyncCount } from "./sync.js";
import { fetchInsumosCatalogo, fetchStockInsumos } from "../db/supabase.js";

// Punto unico para "armar un insumo nuevo" — antes esta misma logica estaba
// copiada en menu.js, proveedores.js y facturas.js, cada una con su propia
// resolucion de id. idsUsados se pasa por referencia y esta funcion lo va
// completando: si se crean varios insumos nuevos en el mismo lote (ej. dos
// lineas de receta nuevas en un mismo producto), el segundo no puede
// colisionar con el id que acaba de resolver el primero.
export function construirInsumoNuevo(nombre, idsUsados, { unidad, stockMinimo, stockCritico } = {}) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("El nombre del insumo nuevo es obligatorio.");

  let id = slugify(nombreLimpio);
  let sufijo = 2;
  while (idsUsados.has(id)) {
    id = `${slugify(nombreLimpio)}-${sufijo}`;
    sufijo += 1;
  }
  idsUsados.add(id);

  const now = new Date().toISOString();
  const unidadFinal = String(unidad || "").trim() || "unidad";
  return {
    id,
    nombre: nombreLimpio,
    unidad: unidadFinal,
    unidadCompra: unidadFinal,
    factorConversion: 1,
    stockActual: 0,
    stockMinimo: parseFloat(String(stockMinimo ?? "").replace(",", ".")) || 0,
    stockCritico: parseFloat(String(stockCritico ?? "").replace(",", ".")) || 0,
    activo: true,
    creadoEn: now,
    actualizadoEn: now
  };
}

// Crear un insumo suelto, sin producto ni proveedor asociado (boton
// "+ Crear insumo" en Gestion > Insumos). Los otros tres lugares que crean
// insumos (Menu, Proveedores, Cargar por factura) usan construirInsumoNuevo
// directo porque necesitan escribirlo en la MISMA transaccion que su
// producto/receta/proveedor_insumo — esta funcion es para cuando no hay
// nada mas que crear junto con el.
export async function createInsumo({ nombre, unidad, stockMinimo, stockCritico }) {
  const insumosActuales = await getAll("insumos");
  const idsUsados = new Set(insumosActuales.map((i) => i.id));
  const insumo = construirInsumoNuevo(nombre, idsUsados, { unidad, stockMinimo, stockCritico });

  await withStores(["insumos"], "readwrite", (stores) => {
    stores.insumos.put(insumo);
  });

  const insumosFinal = await getAll("insumos");
  trySyncInsumosSnapshot(insumosFinal).catch(() => {});

  return insumo;
}

// Trae insumos desde Supabase y los fusiona con lo local (ver "Actualizar
// catalogo" en Gestion) — para que un insumo nuevo creado desde otro
// dispositivo (ej. al agregar la receta de un producto desde el celu)
// aparezca aca. stockActual NUNCA se pisa: es en vivo, se descuenta con cada
// produccion/venta de ESTE dispositivo.
//
// La lectura que protege stockActual tiene que pasar DENTRO de la misma
// transaccion en la que se escribe (ver incidente real del 19/09/2026 en
// pullCatalogoDesdeNube, menu.js — mismo patron, mismo riesgo: leer el local
// ANTES de esperar la red y escribir con ese dato ya viejo pisa cualquier
// venta/produccion que haya pasado mientras tanto en este dispositivo).
export async function pullInsumosDesdeNube() {
  const remotos = await fetchInsumosCatalogo();

  await withStores(["insumos"], "readwrite", async (stores) => {
    for (const r of remotos) {
      const local = await requestToPromise(stores.insumos.get(r.id));
      stores.insumos.put({
        ...(local || { stockActual: 0 }),
        id: r.id,
        nombre: r.nombre,
        unidad: r.unidad,
        unidadCompra: r.unidad_compra || undefined,
        factorConversion: r.factor_conversion,
        stockMinimo: r.stock_minimo,
        stockCritico: r.stock_critico,
        activo: r.activo,
        actualizadoEn: new Date().toISOString()
        // stockActual deliberadamente ausente — sobrevive el spread de arriba.
      });
    }
  });

  return remotos.length;
}

// Reconciliacion del stock de insumos con la nube.
//
// El stock en vivo de un insumo es un valor DERIVADO: la nube lo calcula como
// la suma de todos sus movimientos (trigger, migracion 012) y es la unica
// verdad. Este dispositivo guarda una copia local para poder operar sin
// internet; cuando hay conexion y NO tiene nada pendiente de subir, esa copia
// se alinea con la nube. Si dos dispositivos operaron (ej. el celu escaneo una
// factura mientras la tablet vendia lattes), ambos convergen al mismo numero.
//
// Por que asi y no aplicando deltas: sumar "lo que falta" a un valor local
// depende de que el local ya estuviera perfectamente al dia; un solo desvio
// (un paso perdido, una tablet vieja) se arrastraba para siempre. Copiar la
// suma de la nube no tiene memoria: cualquier desvio se cura en la proxima
// corrida.
//
// Seguridad ante actividad concurrente (nunca pisar algo que la nube todavia
// no vio):
//  - no corre si hay operaciones sin subir (getPendingSyncCount),
//  - y aborta si, mientras esperaba la respuesta de la red, aparecio un
//    movimiento local nuevo (se compara la cantidad de movimientos antes y
//    dentro de la transaccion de escritura). Se reintenta en la proxima.
export async function reconciliarStockInsumosConNube() {
  if (getPendingSyncCount() > 0) return { omitido: "pendientes", corregidos: [] };
  const movimientosAntes = await countAll("movimientos_insumos");
  const remotos = await fetchStockInsumos();

  const corregidos = [];
  let abortado = null;
  await withStores(["insumos", "movimientos_insumos"], "readwrite", async (stores) => {
    const movimientosAhora = await requestToPromise(stores.movimientos_insumos.count());
    if (movimientosAhora !== movimientosAntes) { abortado = "actividad"; return; }
    if (getPendingSyncCount() > 0) { abortado = "pendientes"; return; }
    const now = new Date().toISOString();
    for (const r of remotos) {
      const nube = Number(r.stock_actual);
      if (!Number.isFinite(nube)) continue;
      const local = await requestToPromise(stores.insumos.get(r.id));
      if (!local) continue; // insumo que este dispositivo todavia no conoce: llega con pullInsumosDesdeNube
      const antes = Number(local.stockActual) || 0;
      if (Math.abs(antes - nube) < 1e-9) continue;
      stores.insumos.put({ ...local, stockActual: nube, actualizadoEn: now });
      corregidos.push({ id: r.id, nombre: local.nombre, unidad: local.unidad, antes, despues: nube });
    }
  });

  return abortado ? { omitido: abortado, corregidos: [] } : { corregidos };
}

const SEED_VERSION_KEY = "insumos_seed_version";
const RECETAS_LECHE_ACTUALIZADAS_V8 = [
  "cafe-con-leche:leche-normal",
  "promo-cafe-con-leche:leche-normal",
  "capuccino:leche-normal",
  "ice-latte:leche-normal",
  "ice-caramel:leche-normal"
];
export async function saveInsumoCalibrationSettings(insumoId, { alphaReceta, alphaPrediccion }) {
  const insumos = await getAll("insumos");
  const insumo  = insumos.find(i => i.id === insumoId);
  if (!insumo) return;
  await withStores(["insumos"], "readwrite", stores => {
    stores.insumos.put({ ...insumo, alphaReceta, alphaPrediccion, actualizadoEn: new Date().toISOString() });
  });
}

export async function seedInsumos() {
  const [existingInsumos, existingRecetas, existingConfig] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("configuracion")
  ]);

  const savedVersion = existingConfig.find(c => c.id === SEED_VERSION_KEY)?.valor ?? 0;
  const versionDesactualizada = savedVersion < INSUMOS_SEED_VERSION;

  const existingInsumoIds = new Set(existingInsumos.map(i => i.id));
  const existingRecetaIds = new Set(existingRecetas.map(r => r.id));
  const now = new Date().toISOString();
  const newInsumos = initialInsumos.filter(i => !existingInsumoIds.has(i.id));
  const newRecetas = initialRecetas.filter(r => !existingRecetaIds.has(r.id));

  if (newInsumos.length === 0 && newRecetas.length === 0 && !versionDesactualizada) return;

  await withStores(["insumos", "recetas", "configuracion"], "readwrite", (stores) => {
    for (const insumo of newInsumos) {
      stores.insumos.put({ ...insumo, necesitaCalibracion: false, ultimaCalibracion: null, creadoEn: now, actualizadoEn: now });
    }
    for (const receta of newRecetas) {
      stores.recetas.put({ ...receta, creadoEn: now, actualizadoEn: now });
    }
    if (versionDesactualizada) {
      for (const seedInsumo of initialInsumos) {
        if (existingInsumoIds.has(seedInsumo.id)) {
          const existing = existingInsumos.find(i => i.id === seedInsumo.id);
          stores.insumos.put({ ...existing, stockMinimo: seedInsumo.stockMinimo, stockCritico: seedInsumo.stockCritico, factorConversion: seedInsumo.factorConversion, unidadCompra: seedInsumo.unidadCompra, activo: seedInsumo.activo, actualizadoEn: now });
        }
      }
      // Borra insumos obsoletos que no deberian existir (ej. "Mezcla", reemplazado por Mayonesa)
      for (const existing of existingInsumos) {
        if (INSUMOS_OBSOLETOS_NOMBRES.has(existing.nombre)) {
          stores.insumos.delete(existing.id);
          for (const receta of existingRecetas) {
            if (receta.insumoId === existing.id) stores.recetas.delete(receta.id);
          }
        }
      }
      // Aplica recetaFija a recetas de miga existentes
      for (const seedReceta of initialRecetas) {
        if (seedReceta.recetaFija && existingRecetaIds.has(seedReceta.id)) {
          const existing = existingRecetas.find(r => r.id === seedReceta.id);
          stores.recetas.put({ ...existing, recetaFija: true, actualizadoEn: now });
        }
      }
      // Recalibracion de cantidades de leche por vaso (v8) — solo estas
      // recetas puntuales, no todas: no queremos pisar ajustes que haya
      // hecho la calibracion en otras recetas.
      for (const id of RECETAS_LECHE_ACTUALIZADAS_V8) {
        if (existingRecetaIds.has(id)) {
          const seedReceta = initialRecetas.find(r => r.id === id);
          const existing = existingRecetas.find(r => r.id === id);
          if (seedReceta && existing) {
            stores.recetas.put({ ...existing, cantidadPorUnidad: seedReceta.cantidadPorUnidad, actualizadoEn: now });
          }
        }
      }
      stores.configuracion.put({ id: SEED_VERSION_KEY, valor: INSUMOS_SEED_VERSION, actualizadoEn: now });
    }
  });
}

export async function listInsumos() {
  const insumos = await getAll("insumos");
  return insumos
    .filter(i => i.activo)
    .map(i => ({
      ...i,
      stockEnCompra: i.stockActual / i.factorConversion,
      estadoStock: i.stockActual <= i.stockCritico ? "critico"
                 : i.stockActual <= i.stockMinimo ? "bajo"
                 : "ok"
    }))
    .sort((a, b) => {
      const order = { critico: 0, bajo: 1, ok: 2 };
      return (order[a.estadoStock] - order[b.estadoStock]) || a.nombre.localeCompare(b.nombre);
    });
}

export async function listaDeComprasSmart() {
  const [insumos, historialAll, recetas, proveedorInsumos, proveedores] = await Promise.all([
    getAll("insumos"),
    getAll("historial_calibraciones"),
    getAll("recetas"),
    getAll("proveedor_insumos"),
    getAll("proveedores")
  ]);

  const proveedoresById = new Map(proveedores.filter(p => p.activo).map(p => [p.id, p]));
  const activePI = proveedorInsumos.filter(pi => pi.activo && pi.insumoId);

  const items = insumos
    .filter(i => i.activo)
    .map(insumo => {
      const recetasDelInsumo = recetas.filter(r => r.insumoId === insumo.id);
      const historial = historialAll
        .filter(h => h.insumoId === insumo.id)
        .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));

      let consumoDiario = 0;
      if (historial.length > 0 && recetasDelInsumo.length > 0) {
        const alpha = insumo.alphaPrediccion ?? 0.50;
        const currentRecipe = recetasDelInsumo[0].cantidadPorUnidad;
        const rates = historial.map((h, idx) => {
          const prev = idx > 0 ? new Date(historial[idx - 1].creadoEn) : null;
          const curr = new Date(h.creadoEn);
          const days = prev ? Math.max(1, (curr - prev) / 86400000) : 7;
          return h.sandwiches / days;
        });
        let ema = rates[0];
        for (let k = 1; k < rates.length; k++) ema = alpha * rates[k] + (1 - alpha) * ema;
        consumoDiario = ema * currentRecipe;
      }
      if (consumoDiario <= 0 && insumo.stockMinimo > 0) consumoDiario = insumo.stockMinimo / 7;

      const diasRestantes = consumoDiario > 0 ? Math.round(insumo.stockActual / consumoDiario) : null;
      const estadoStock = insumo.stockActual <= insumo.stockCritico ? "critico"
        : insumo.stockActual <= insumo.stockMinimo ? "bajo" : "ok";

      const suppliers = activePI
        .filter(pi => pi.insumoId === insumo.id)
        .map(pi => {
          const prov = proveedoresById.get(pi.proveedorId);
          if (!prov) return null;
          const diasCiclo = prov.diasCiclo ?? 7;
          const necesidad = consumoDiario > 0
            ? consumoDiario * diasCiclo + insumo.stockMinimo
            : insumo.stockMinimo * 1.5;
          const cantidadAPedir = Math.max(0, necesidad - insumo.stockActual);
          const cantidadEnCompra = Math.ceil(cantidadAPedir / pi.cantidadPorUnidad);
          return {
            proveedorId: prov.id,
            proveedorNombre: prov.nombre,
            diasCiclo,
            productoNombre: pi.nombreProducto,
            unidadCompra: pi.unidadCompra,
            cantidadAPedir,
            cantidadEnCompra,
            costoTotalCentavos: cantidadEnCompra * pi.precioUnitarioCentavos,
            costoPorUnidadBase: pi.precioUnitarioCentavos / pi.cantidadPorUnidad
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.costoPorUnidadBase - b.costoPorUnidadBase);

      const mejorSupplier = suppliers[0] ?? null;
      const minDiasCiclo = suppliers.length > 0 ? Math.min(...suppliers.map(s => s.diasCiclo)) : 7;

      let urgencia;
      if (estadoStock === "critico" || (diasRestantes !== null && diasRestantes < minDiasCiclo)) {
        urgencia = "urgente";
      } else if (estadoStock === "bajo" || (diasRestantes !== null && diasRestantes < minDiasCiclo * 1.5)) {
        urgencia = "pronto";
      } else {
        urgencia = "ok";
      }

      return { ...insumo, consumoDiario, diasRestantes, estadoStock, urgencia, suppliers, mejorSupplier };
    })
    .sort((a, b) => {
      const o = { urgente: 0, pronto: 1, ok: 2 };
      return (o[a.urgencia] - o[b.urgencia])
        || ((a.diasRestantes ?? 999) - (b.diasRestantes ?? 999))
        || a.nombre.localeCompare(b.nombre);
    });

  const byProveedorMap = new Map();
  for (const item of items) {
    if (!item.mejorSupplier) continue;
    const pid = item.mejorSupplier.proveedorId;
    if (!byProveedorMap.has(pid)) {
      byProveedorMap.set(pid, {
        proveedorId: pid,
        proveedorNombre: item.mejorSupplier.proveedorNombre,
        diasCiclo: item.mejorSupplier.diasCiclo,
        items: []
      });
    }
    byProveedorMap.get(pid).items.push(item);
  }

  const byProveedor = Array.from(byProveedorMap.values())
    .sort((a, b) => a.proveedorNombre.localeCompare(b.proveedorNombre));

  return { items, byProveedor };
}

export async function ajustarStockInsumo(insumoId, cantidad, tipo) {
  const now = new Date().toISOString();
  const fecha = todayISO();

  // Leer FUERA de la transacción — await dentro de withStores auto-cierra la tx en IDB
  const todosInsumos = await getAll("insumos");
  const insumo = todosInsumos.find(i => i.id === insumoId);
  if (!insumo) throw new Error("Insumo no encontrado.");

  const stockAnterior = insumo.stockActual;
  const stockNuevo = stockAnterior + cantidad;
  if (stockNuevo < 0) throw new Error(`Stock resultante negativo para ${insumo.nombre}.`);

  // Todos los ajustes corrigen el baseline junto con el stock para que la calibración
  // vea solo consumo real de sandwiches, no compras ni pérdidas.
  const AJUSTA_BASELINE = new Set(["compra", "desperdicio", "no_recibido", "error_conteo"]);
  const ultimaCalibracion = AJUSTA_BASELINE.has(tipo) && insumo.ultimaCalibracion
    ? { ...insumo.ultimaCalibracion, stockEnCalibracion: (insumo.ultimaCalibracion.stockEnCalibracion || 0) + cantidad }
    : insumo.ultimaCalibracion;

  // Escribir sincrónico — sin await adentro
  return withStores(["insumos", "movimientos_insumos"], "readwrite", (stores) => {
    stores.insumos.put({ ...insumo, stockActual: stockNuevo, ultimaCalibracion, actualizadoEn: now });
    stores.movimientos_insumos.add({ uuid: crypto.randomUUID(), insumoId, tipo, cantidad, stockAnterior, stockNuevo, fecha, creadoEn: now });
  });
}

export async function calibrarInsumo(insumoId, stockRealRaw, alphaRecetaOverride = null) {
  const stockReal = parseFloat(String(stockRealRaw).replace(",", "."));
  if (isNaN(stockReal) || stockReal < 0) throw new Error("El stock real debe ser un numero positivo.");
  const now = new Date().toISOString();
  const fecha = todayISO();

  // Leer TODO antes de abrir la transacción — dentro de la tx no puede haber await
  const [todosInsumos, todasLasRecetas, todosHistoriales] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("historial_calibraciones")
  ]);

  const insumo = todosInsumos.find(i => i.id === insumoId);
  if (!insumo) throw new Error("Insumo no encontrado.");

  const cal = insumo.ultimaCalibracion;
  const recetasDelInsumo = todasLasRecetas.filter(r => r.insumoId === insumoId);
  const nCalibraciones = todosHistoriales.filter(h => h.insumoId === insumoId).length;

  // Calcular calibración fuera de la transacción
  let eventoCalib = null;
  let recetasActualizadas = [];

  if (cal && cal.ventasPorProducto && Object.keys(cal.ventasPorProducto).length > 0 && recetasDelInsumo.length > 0) {
    let consumoEsperado = 0;
    let totalSandwiches = 0;
    for (const receta of recetasDelInsumo) {
      const qty = cal.ventasPorProducto[receta.productoId] || 0;
      consumoEsperado += receta.cantidadPorUnidad * qty;
      totalSandwiches += qty;
    }
    const consumoReal = cal.stockEnCalibracion - stockReal;

    if (consumoEsperado > 0 && consumoReal > 0 && totalSandwiches > 0) {
      const factorObservado = consumoReal / consumoEsperado;
      const factorClamped = Math.min(2.0, Math.max(0.5, factorObservado));

      const alphaReceta = alphaRecetaOverride != null ? alphaRecetaOverride : (insumo.alphaReceta ?? 0.80);
      const alphaBase = Math.max(alphaReceta, 1 / (nCalibraciones + 1));
      const sampleBoost = totalSandwiches < 50 ? 1.3 : totalSandwiches < 100 ? 1.1 : 1.0;
      const alpha = Math.min(0.99, alphaBase * sampleBoost);

      const estimadoAntes = recetasDelInsumo[0].cantidadPorUnidad;
      const estimadoDespues = parseFloat((estimadoAntes * (alpha * factorClamped + (1 - alpha))).toFixed(4));
      const ajusteAplicado = estimadoDespues !== estimadoAntes;

      const todasFijas = recetasDelInsumo.every(r => r.recetaFija);

      eventoCalib = {
        uuid: crypto.randomUUID(),
        insumoId, fecha,
        stockAntes: cal.stockEnCalibracion, stockReal,
        sandwiches: totalSandwiches,
        consumoEsperado: parseFloat(consumoEsperado.toFixed(4)),
        consumoReal: parseFloat(consumoReal.toFixed(4)),
        factorObservado: parseFloat(factorObservado.toFixed(4)),
        factorClamped: parseFloat(factorClamped.toFixed(4)),
        alphaUsado: todasFijas ? 0 : parseFloat(alpha.toFixed(4)),
        estimadoAntes,
        estimadoDespues: todasFijas ? estimadoAntes : estimadoDespues,
        ajusteAplicado: todasFijas ? false : ajusteAplicado,
        ...(todasFijas ? { recetaFija: true } : {}),
        creadoEn: now
      };

      if (!todasFijas) {
        for (const receta of recetasDelInsumo) {
          if (receta.recetaFija) continue;
          recetasActualizadas.push({
            ...receta,
            cantidadPorUnidad: parseFloat((receta.cantidadPorUnidad * (alpha * factorClamped + (1 - alpha))).toFixed(4)),
            esEstimado: true,
            actualizadoEn: now
          });
        }
      }
    }
  }

  const insumoActualizado = {
    ...insumo,
    stockActual: stockReal,
    ...(alphaRecetaOverride != null ? { alphaReceta: alphaRecetaOverride } : {}),
    necesitaCalibracion: false,
    ultimaCalibracion: { fecha: now, stockEnCalibracion: stockReal, ventasPorProducto: {} },
    actualizadoEn: now
  };

  const movimiento = {
    uuid: crypto.randomUUID(),
    insumoId, tipo: "calibracion",
    cantidad: stockReal - insumo.stockActual,
    stockAnterior: insumo.stockActual, stockNuevo: stockReal,
    fecha, creadoEn: now
  };

  // Escribir todo en una transacción sincrónica — sin ningún await adentro
  await withStores(["insumos", "recetas", "movimientos_insumos", "historial_calibraciones"], "readwrite", (stores) => {
    stores.insumos.put(insumoActualizado);
    stores.movimientos_insumos.add(movimiento);
    if (eventoCalib) {
      stores.historial_calibraciones.add(eventoCalib);
      for (const receta of recetasActualizadas) {
        stores.recetas.put(receta);
      }
    }
  });

  // Sync asíncrono — no bloquea la UI aunque Supabase falle
  if (eventoCalib) {
    const [syncInsumos, syncRecetas] = await Promise.all([getAll("insumos"), getAll("recetas")]);
    trySyncCalibracion(eventoCalib).catch(() => {});
    trySyncInsumosSnapshot(syncInsumos).catch(() => {});
    trySyncRecetasSnapshot(syncRecetas).catch(() => {});
  }
}

export async function getRecetasDashboardData() {
  const [recetas, insumos, productos, historialRecetas] = await Promise.all([
    getAll("recetas"),
    getAll("insumos"),
    getAll("productos"),
    getAll("historial_recetas")
  ]);
  const insumoMap = new Map(insumos.map(i => [i.id, i]));
  const productoMap = new Map(productos.map(p => [p.id, p]));
  const historialPorReceta = new Map();
  for (const h of historialRecetas) {
    if (!historialPorReceta.has(h.recetaId)) historialPorReceta.set(h.recetaId, []);
    historialPorReceta.get(h.recetaId).push(h);
  }

  const porProducto = new Map();
  for (const r of recetas) {
    if (!porProducto.has(r.productoId)) porProducto.set(r.productoId, []);
    const insumo = insumoMap.get(r.insumoId);
    if (!insumo) continue;
    const historial = (historialPorReceta.get(r.id) || [])
      .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
      .slice(0, 5);
    porProducto.get(r.productoId).push({ ...r, insumoNombre: insumo.nombre, unidad: insumo.unidad, historial });
  }

  return Array.from(porProducto.entries())
    .map(([productoId, recetasDelProducto]) => ({
      productoId,
      productoNombre: productoMap.get(productoId)?.nombre ?? productoId,
      recetas: recetasDelProducto
    }))
    .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
}

export async function actualizarReceta(recetaId, nuevaCantidadRaw, motivo = "", recetaFija = null) {
  const nuevaCantidad = parseFloat(String(nuevaCantidadRaw).replace(",", "."));
  if (isNaN(nuevaCantidad) || nuevaCantidad < 0) throw new Error("La cantidad debe ser un número positivo.");
  const now = new Date().toISOString();

  // Leer fuera de la transacción — await dentro de withStores cierra la tx automáticamente
  const todasRecetas = await getAll("recetas");
  const receta = todasRecetas.find(r => r.id === recetaId);
  if (!receta) throw new Error("Receta no encontrada.");

  const valorAnterior = receta.cantidadPorUnidad;
  const updatedReceta = {
    ...receta,
    cantidadPorUnidad: nuevaCantidad,
    esEstimado: false,
    actualizadoEn: now,
    ...(recetaFija !== null ? { recetaFija } : {})
  };

  const eventoHistorial = {
    uuid: crypto.randomUUID(),
    recetaId,
    productoId: receta.productoId,
    insumoId: receta.insumoId,
    valorAnterior,
    valorNuevo: nuevaCantidad,
    motivo: motivo.trim(),
    creadoEn: now
  };

  await withStores(["recetas", "historial_recetas"], "readwrite", (stores) => {
    stores.recetas.put(updatedReceta);
    stores.historial_recetas.add(eventoHistorial);
  });

  trySyncHistorialReceta(eventoHistorial).catch(() => {});
}

export async function exportarListaCompras() {
  const { items, byProveedor } = await listaDeComprasSmart();
  const fecha = todayISO();
  let txt = `MIGA POS — LISTA DE COMPRAS\n${"=".repeat(40)}\nFecha: ${fecha}\n\n`;

  const urgentes = items.filter(i => i.urgencia === "urgente");
  const prontos = items.filter(i => i.urgencia === "pronto");

  if (urgentes.length === 0 && prontos.length === 0) {
    txt += "Todo el stock esta OK. No hay nada que reponer.\n";
    return txt;
  }

  if (urgentes.length > 0) {
    txt += `[URGENTE — pedir hoy]\n${"-".repeat(30)}\n`;
    for (const item of urgentes) {
      const dias = item.diasRestantes !== null ? ` (${item.diasRestantes}d)` : "";
      const s = item.mejorSupplier;
      const prov = s ? ` via ${s.proveedorNombre}` : "";
      const cant = s ? `: ${s.cantidadEnCompra} ${s.unidadCompra}` : "";
      txt += `  ${item.nombre}${dias}${prov}${cant}\n`;
    }
    txt += "\n";
  }

  if (byProveedor.length > 0) {
    txt += `POR PROVEEDOR\n${"=".repeat(30)}\n`;
    for (const group of byProveedor) {
      const totalCentavos = group.items.reduce((s, i) => s + (i.mejorSupplier?.costoTotalCentavos ?? 0), 0);
      txt += `\n${group.proveedorNombre.toUpperCase()}`;
      if (group.diasCiclo) txt += ` (ciclo ${group.diasCiclo}d)`;
      if (totalCentavos > 0) txt += ` — ~€${(totalCentavos / 100).toFixed(2)}`;
      txt += "\n";
      for (const item of group.items) {
        const s = item.mejorSupplier;
        const dias = item.diasRestantes !== null ? ` [${item.diasRestantes}d]` : "";
        const urg = item.urgencia === "urgente" ? " !" : "";
        txt += `  ${urg}${item.nombre}${dias}: ${s.cantidadEnCompra} ${s.unidadCompra}\n`;
      }
    }
  }
  return txt;
}

export async function getCalibracionDashboardData() {
  const [insumos, recetas, historialAll] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("historial_calibraciones")
  ]);

  return insumos
    .filter(i => i.activo)
    .map(i => {
      const recetasDelInsumo = recetas.filter(r => r.insumoId === i.id);
      const cal = i.ultimaCalibracion;
      let consumoEsperado = 0;
      let totalSandwiches = 0;
      if (cal?.ventasPorProducto) {
        for (const receta of recetasDelInsumo) {
          const qty = cal.ventasPorProducto[receta.productoId] || 0;
          consumoEsperado += receta.cantidadPorUnidad * qty;
          totalSandwiches += qty;
        }
      }

      const historial = historialAll
        .filter(h => h.insumoId === i.id)
        .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
      const nCalibraciones = historial.length;
      const ultimasCinco = historial.slice(-5);
      const lastFactors = ultimasCinco.map(h => h.factorObservado);

      // Confianza: basada en la dispersión de los últimos factores
      let confianza = 0;
      let tendencia = "sin datos";
      if (nCalibraciones === 1) {
        confianza = 25;
        tendencia = "aprendiendo";
      } else if (nCalibraciones >= 2) {
        const mean = lastFactors.reduce((a, b) => a + b, 0) / lastFactors.length;
        const variance = lastFactors.reduce((s, f) => s + Math.pow(f - mean, 2), 0) / lastFactors.length;
        const stdDev = Math.sqrt(variance);
        // stdDev < 0.03 → 100%, stdDev > 0.30 → 0%
        confianza = Math.max(0, Math.min(100, Math.round((1 - stdDev / 0.30) * 100)));
        const lastF = lastFactors[lastFactors.length - 1];
        const prevF = lastFactors[lastFactors.length - 2];
        const convergiendo = Math.abs(lastF - 1) < Math.abs(prevF - 1);
        if (confianza >= 80 && Math.abs(lastF - 1) < 0.05) {
          tendencia = "calibrado";
        } else {
          tendencia = convergiendo ? "mejorando" : "ajustando";
        }
      }

      const alphaReceta     = i.alphaReceta     ?? 0.80;
      const alphaPrediccion = i.alphaPrediccion ?? 0.50;

      // Predicción de días de stock restante usando EMA de ritmo de producción
      let diasRestantes = null;
      if (historial.length > 0 && recetasDelInsumo.length > 0) {
        const currentRecipe = recetasDelInsumo[0].cantidadPorUnidad;
        const rates = historial.map((h, idx) => {
          const prevDate = idx > 0 ? new Date(historial[idx - 1].creadoEn) : null;
          const currDate = new Date(h.creadoEn);
          const days = prevDate ? Math.max(1, (currDate - prevDate) / 86400000) : 7;
          return h.sandwiches / days;
        });
        let ema = rates[0];
        for (let k = 1; k < rates.length; k++) {
          ema = alphaPrediccion * rates[k] + (1 - alphaPrediccion) * ema;
        }
        const consumoPorDia = ema * currentRecipe;
        if (consumoPorDia > 0) diasRestantes = Math.round(i.stockActual / consumoPorDia);
      }

      let sandwichesEstimados = null;
      if (recetasDelInsumo.length > 0 && recetasDelInsumo[0].cantidadPorUnidad > 0) {
        sandwichesEstimados = Math.floor(i.stockActual / recetasDelInsumo[0].cantidadPorUnidad);
      }

      return {
        ...i,
        stockEnCompra: i.stockActual / i.factorConversion,
        estadoStock: i.stockActual <= i.stockCritico ? "critico" : i.stockActual <= i.stockMinimo ? "bajo" : "ok",
        ultimaCalibracionFecha: cal?.fecha || null,
        consumoEsperado,
        totalSandwichesDesdeCalibracion: totalSandwiches,
        historial: ultimasCinco,
        nCalibraciones,
        lastFactors,
        confianza,
        tendencia,
        sandwichesEstimados,
        alphaReceta,
        alphaPrediccion,
        diasRestantes
      };
    })
    .sort((a, b) => {
      if (a.necesitaCalibracion && !b.necesitaCalibracion) return -1;
      if (!a.necesitaCalibracion && b.necesitaCalibracion) return 1;
      if (!a.ultimaCalibracionFecha && b.ultimaCalibracionFecha) return -1;
      if (a.ultimaCalibracionFecha && !b.ultimaCalibracionFecha) return 1;
      return a.nombre.localeCompare(b.nombre);
    });
}

// Chequeo de solo lectura (sin escribir nada) para saber, ANTES de guardar
// produccion, que insumos quedarian en negativo. Se usa para avisar al cocinero
// y darle la opcion de ir a actualizar el stock del insumo antes de continuar.
export async function previewProduccionInsumos(productId, cantidadProducida) {
  const [recetas, insumos] = await Promise.all([getAll("recetas"), getAll("insumos")]);
  const recetasDelProducto = recetas.filter((r) => r.productoId === productId);
  if (recetasDelProducto.length === 0) return [];

  const insumosById = new Map(insumos.map((i) => [i.id, i]));
  const faltantes = [];
  for (const receta of recetasDelProducto) {
    const insumo = insumosById.get(receta.insumoId);
    if (!insumo || !insumo.activo) continue;
    const total = receta.cantidadPorUnidad * cantidadProducida;
    const stockResultante = insumo.stockActual - total;
    if (stockResultante < 0) {
      faltantes.push({
        insumoId: insumo.id,
        nombre: insumo.nombre,
        unidad: insumo.unidad,
        stockActual: insumo.stockActual,
        stockResultante
      });
    }
  }
  return faltantes;
}

// Called within saveDailyProduction / adjustStockLevel transactions.
// cantidadProducida > 0 = producción (descuenta insumos)
// cantidadProducida < 0 = corrección de error (devuelve insumos)
// No se clampea en 0: si el insumo no alcanza, se deja en negativo a proposito
// (el deficit real, no uno truncado) y se avisa en `warnings`. Se autoresuelve
// solo la proxima vez que se cargue una compra de ese insumo.
export async function deductInsumosForProductionInTx(stores, productId, cantidadProducida, fecha, now) {
  const todasLasRecetas = await requestToPromise(stores.recetas.getAll());
  if (todasLasRecetas.length === 0) return { movimientos: [], warnings: [] };
  const recetasDelProducto = todasLasRecetas.filter(r => r.productoId === productId);
  if (recetasDelProducto.length === 0) return { movimientos: [], warnings: [] };

  const movimientosCreados = [];
  const warnings = [];
  for (const receta of recetasDelProducto) {
    const insumo = await requestToPromise(stores.insumos.get(receta.insumoId));
    if (!insumo || !insumo.activo) continue;
    const total = receta.cantidadPorUnidad * cantidadProducida;
    const stockAnterior = insumo.stockActual;
    const stockNuevo = stockAnterior - total;
    const cal = insumo.ultimaCalibracion
      ? { ...insumo.ultimaCalibracion, ventasPorProducto: { ...insumo.ultimaCalibracion.ventasPorProducto } }
      : { fecha: now, stockEnCalibracion: stockAnterior, ventasPorProducto: {} };
    cal.ventasPorProducto[productId] = Math.max(
      0,
      (cal.ventasPorProducto[productId] || 0) + cantidadProducida
    );
    const cruzaMinimo = stockAnterior > insumo.stockMinimo && stockNuevo <= insumo.stockMinimo;
    stores.insumos.put({
      ...insumo, stockActual: stockNuevo,
      necesitaCalibracion: insumo.necesitaCalibracion || cruzaMinimo,
      ultimaCalibracion: cal, actualizadoEn: now
    });
    const mov = { uuid: crypto.randomUUID(), insumoId: receta.insumoId, tipo: "produccion", cantidad: -total, stockAnterior, stockNuevo, productoId: productId, fecha, creadoEn: now };
    stores.movimientos_insumos.add(mov);
    movimientosCreados.push(mov);
    if (stockNuevo < 0) {
      warnings.push(`Falta stock de ${insumo.nombre}: quedo en ${stockNuevo}${insumo.unidad}. Carga la compra pronto.`);
    }
  }
  return { movimientos: movimientosCreados, warnings };
}

// Productos con una opcion a elegir en caja (ver Gestion > Variantes, grupos
// como "Tipo de leche"): la receta del producto siempre apunta al insumo por
// defecto del grupo, pero si el cliente eligio otra opcion en caja hay que
// descontar/devolver ESE insumo puntual, no el de la receta por defecto —
// sino la leche de avena/sin lactosa (o lo que sea que se agregue despues)
// nunca baja de stock por mas que el selector diga que se vendio.
// Default de emergencia si todavia no se guardo nunca nada en Gestion >
// Variantes (ej. recien deployado este cambio) — mismo dataset con el que
// arranco el sistema. La version editable (con soporte para varios grupos)
// vive en variantes.js; no se importa de aca para evitar un import circular
// (variantes.js ya importa construirInsumoNuevo desde este archivo).
const GRUPOS_VARIANTES_DEFAULT = [
  {
    id: "leche",
    opciones: [
      { nombre: "Entera", insumoId: "leche-normal" },
      { nombre: "Avena", insumoId: "leche-avena" },
      { nombre: "Sin lactosa", insumoId: "leche-sin-lactosa" }
    ]
  }
];

// Lee TODOS los grupos de variante (Gestion > Variantes) DENTRO de la
// transaccion activa — por eso stores.configuracion.get en vez de
// getGruposVariantes() de variantes.js, que abre su propia lectura afuera de
// cualquier transaccion.
async function cargarGruposVariantes(stores) {
  const row = await requestToPromise(stores.configuracion.get("variantes_grupos"));
  return Array.isArray(row?.valor) && row.valor.length > 0 ? row.valor : GRUPOS_VARIANTES_DEFAULT;
}

// OJO: la resolucion tiene que hacerse POR GRUPO, nunca con un mapa
// "opcion -> insumo" combinado entre todos los grupos — si dos grupos
// distintos (ej. "Tipo de leche" y "Tipo de cafe") tuvieran una opcion con
// el mismo nombre, un mapa combinado cruzaria mal la sustitucion (la leche
// terminaria descontando como si fuera cafe). Por eso primero se busca a que
// grupo pertenece el insumo de la receta, y solo ahi se busca la opcion
// elegida DENTRO de ese mismo grupo.
//
// Ademas de cambiar el insumo, cada opcion puede tener su PROPIA cantidad
// (ej. la avena rinde distinto que la leche entera) via
// receta.variantesCantidad[opcionNombre] — ver menu.js/render-menu.js. Si no
// hay override para esa opcion (o es invalido), se usa la cantidad base de
// la receta tal cual.
function resolverLineaEfectiva(receta, opcionNombre, grupos) {
  if (!opcionNombre) return { insumoId: receta.insumoId, cantidad: receta.cantidadPorUnidad };
  const grupo = grupos.find((g) => (g.opciones || []).some((o) => o.insumoId === receta.insumoId));
  if (!grupo) return { insumoId: receta.insumoId, cantidad: receta.cantidadPorUnidad };
  const opcionElegida = grupo.opciones.find((o) => o.nombre === opcionNombre);
  if (!opcionElegida) return { insumoId: receta.insumoId, cantidad: receta.cantidadPorUnidad };
  const override = receta.variantesCantidad?.[opcionNombre];
  const cantidad = typeof override === "number" && override > 0 ? override : receta.cantidadPorUnidad;
  return { insumoId: opcionElegida.insumoId, cantidad };
}

// Compartido entre deductInsumosInTx y restoreInsumosInTx — tienen que
// resolver la variante de leche exactamente igual, sino deshacer una venta
// devolveria un insumo distinto (o una cantidad distinta) de lo que se
// desconto al venderla.
function calcularConsumoInsumos(todasLasRecetas, saleItems, grupos) {
  const consumo = new Map();
  for (const item of saleItems) {
    const recetasDelProducto = todasLasRecetas.filter(r => r.productoId === item.productId);
    for (const receta of recetasDelProducto) {
      const { insumoId, cantidad } = resolverLineaEfectiva(receta, item.opcionNombre, grupos);
      if (!consumo.has(insumoId)) {
        consumo.set(insumoId, { total: 0, ventasPorProducto: {} });
      }
      const c = consumo.get(insumoId);
      c.total += cantidad * item.quantity;
      c.ventasPorProducto[item.productId] = (c.ventasPorProducto[item.productId] || 0) + item.quantity;
    }
  }
  return consumo;
}

// Called within confirmSale's transaction. Returns the movimientos created (for sync).
// saleItems: [{ productId, quantity, opcionNombre }]
export async function deductInsumosInTx(stores, saleItems, ventaId, fecha, now, ventaUuid) {
  const todasLasRecetas = await requestToPromise(stores.recetas.getAll());
  if (todasLasRecetas.length === 0) return [];
  const grupos = await cargarGruposVariantes(stores);
  const consumo = calcularConsumoInsumos(todasLasRecetas, saleItems, grupos);

  const movimientosCreados = [];
  for (const [insumoId, { total, ventasPorProducto }] of consumo) {
    const insumo = await requestToPromise(stores.insumos.get(insumoId));
    if (!insumo || !insumo.activo) continue;
    const stockAnterior = insumo.stockActual;
    // Sin piso en 0: el movimiento registra -total y la nube suma exactamente
    // eso, asi que el stock local tiene que moverse igual. Un negativo es la
    // señal buscada de "falta cargar una factura", no un error a esconder.
    const stockNuevo = stockAnterior - total;
    const cal = insumo.ultimaCalibracion
      ? { ...insumo.ultimaCalibracion, ventasPorProducto: { ...insumo.ultimaCalibracion.ventasPorProducto } }
      : { fecha: now, stockEnCalibracion: stockAnterior, ventasPorProducto: {} };
    for (const [pid, qty] of Object.entries(ventasPorProducto)) {
      cal.ventasPorProducto[pid] = (cal.ventasPorProducto[pid] || 0) + qty;
    }
    const cruzaMinimo = stockAnterior > insumo.stockMinimo && stockNuevo <= insumo.stockMinimo;
    stores.insumos.put({
      ...insumo,
      stockActual: stockNuevo,
      necesitaCalibracion: insumo.necesitaCalibracion || cruzaMinimo,
      ultimaCalibracion: cal,
      actualizadoEn: now
    });
    const mov = { uuid: crypto.randomUUID(), insumoId, tipo: "venta", cantidad: -total, stockAnterior, stockNuevo, ventaId, ventaUuid, fecha, creadoEn: now };
    stores.movimientos_insumos.add(mov);
    movimientosCreados.push(mov);
  }
  return movimientosCreados;
}

// Inverso de deductInsumosInTx — se llama al deshacer una venta (undoSale en
// business.js) para reponer lo que se habia descontado. No toca la
// calibracion (una anulacion es una correccion, no un nuevo patron de
// consumo real).
export async function restoreInsumosInTx(stores, saleItems, ventaId, fecha, now, ventaUuid) {
  const todasLasRecetas = await requestToPromise(stores.recetas.getAll());
  if (todasLasRecetas.length === 0) return [];
  const grupos = await cargarGruposVariantes(stores);
  const consumo = calcularConsumoInsumos(todasLasRecetas, saleItems, grupos);

  const movimientosCreados = [];
  for (const [insumoId, { total }] of consumo) {
    const insumo = await requestToPromise(stores.insumos.get(insumoId));
    if (!insumo || !insumo.activo) continue;
    const stockAnterior = insumo.stockActual;
    const stockNuevo = stockAnterior + total;
    stores.insumos.put({ ...insumo, stockActual: stockNuevo, actualizadoEn: now });
    const mov = { uuid: crypto.randomUUID(), insumoId, tipo: "devolucion", cantidad: total, stockAnterior, stockNuevo, ventaId, ventaUuid, fecha, creadoEn: now };
    stores.movimientos_insumos.add(mov);
    movimientosCreados.push(mov);
  }
  return movimientosCreados;
}
