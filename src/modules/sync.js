import {
  pushVenta,
  pushCalibracion,
  pushInsumosSnapshot,
  pushRecetasSnapshot,
  pushMovimientosInsumos,
  pushStockProductos,
  pushProduccionDiaria,
  updateVentaAnulada
} from "../db/supabase.js";

const QUEUE_KEY = "miga_sync_queue";

function loadQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function saveQueue(q) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
  catch { /* localStorage lleno — ignorar */ }
}

export function getPendingSyncCount() {
  return loadQueue().length;
}

function enqueue(op) {
  const q = loadQueue();
  q.push({ ...op, enqueuedAt: new Date().toISOString() });
  saveQueue(q);
}

async function executeOp(op) {
  switch (op.type) {
    case "venta":
      return pushVenta(op.payload);
    case "calibracion":
      return pushCalibracion(op.payload);
    case "insumos_snapshot":
      return pushInsumosSnapshot(op.payload);
    case "recetas_snapshot":
      return pushRecetasSnapshot(op.payload);
    case "movimientos_insumos":
      return pushMovimientosInsumos(op.payload);
    case "stock_productos":
      return pushStockProductos(op.payload);
    case "produccion_diaria":
      return pushProduccionDiaria(op.payload);
    case "venta_anulada":
      return updateVentaAnulada(op.payload.fecha, op.payload.creadoEn);
    default:
      throw new Error(`Tipo de sync desconocido: ${op.type}`);
  }
}

export async function processSyncQueue() {
  if (!navigator.onLine) return { synced: 0, pending: getPendingSyncCount() };
  const q = loadQueue();
  if (q.length === 0) return { synced: 0, pending: 0 };

  const failed = [];
  let synced = 0;
  for (const op of q) {
    try {
      await executeOp(op);
      synced++;
    } catch (e) {
      console.warn("[sync] Reintento fallido:", op.type, e.message);
      failed.push(op);
    }
  }
  saveQueue(failed);
  return { synced, pending: failed.length };
}

async function tryNow(op) {
  if (!navigator.onLine) { enqueue(op); return false; }
  try {
    await executeOp(op);
    return true;
  } catch (e) {
    console.warn("[sync] Sync fallido, encolando:", op.type, e.message);
    enqueue(op);
    return false;
  }
}

export function trySyncVenta(payload) {
  return tryNow({ type: "venta", payload });
}

export function trySyncCalibracion(payload) {
  return tryNow({ type: "calibracion", payload });
}

export function trySyncInsumosSnapshot(insumos) {
  return tryNow({ type: "insumos_snapshot", payload: insumos });
}

export function trySyncRecetasSnapshot(recetas) {
  return tryNow({ type: "recetas_snapshot", payload: recetas });
}

export function trySyncMovimientosInsumos(movimientos) {
  return tryNow({ type: "movimientos_insumos", payload: movimientos });
}

// Para "modo consulta" en otros dispositivos: mantiene stock_productos y
// produccion_diaria al dia en Supabase despues de cada venta/produccion/ajuste.
export function trySyncStockProductos(productos) {
  return tryNow({ type: "stock_productos", payload: productos });
}

export function trySyncProduccionDiaria(rows) {
  return tryNow({ type: "produccion_diaria", payload: rows });
}

export function trySyncVentaAnulada({ fecha, creadoEn }) {
  return tryNow({ type: "venta_anulada", payload: { fecha, creadoEn } });
}

// Retry automático al recuperar conexión
export function setupAutoSync() {
  window.addEventListener("online", () => {
    console.log("[sync] Conexión recuperada — procesando cola...");
    processSyncQueue().then(({ synced, pending }) => {
      if (synced > 0) console.log(`[sync] ${synced} operaciones sincronizadas. Pendientes: ${pending}`);
    }).catch(console.error);
  });
}
