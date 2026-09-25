import {
  pushVenta,
  pushCalibracion,
  pushCatalogoSnapshot,
  pushInsumosSnapshot,
  pushRecetasSnapshot,
  pushProveedoresSnapshot,
  pushProveedorInsumosSnapshot,
  pushMovimientosInsumos,
  pushStockProductos,
  pushProduccionDiaria,
  pushMovimientoStock,
  updateVentaAnulada,
  pushVariantesGrupos,
  pushHistorialReceta,
  pushConfiguracionCompartida
} from "../db/supabase.js";

// ---------------------------------------------------------------------------
// Cola de operaciones pendientes (offline-first).
//
// Garantias que sostiene este archivo:
//  1. DURABLE: toda operacion se escribe en la cola ANTES de intentar la red
//     (write-ahead). Si la pestaña se cierra o se corta la luz a mitad de un
//     push, la operacion sigue en la cola y se reintenta. Es seguro porque
//     todo push es idempotente por uuid (ver CLAUDE.md 8.7).
//  2. SIN PISADAS: el drenado nunca reescribe la cola entera con una copia
//     vieja — solo saca por id las operaciones que se confirmaron. Lo que se
//     encole mientras hay un push en vuelo no se pierde.
//  3. UN SOLO DRENADO A LA VEZ: dentro de la pestaña (single-flight) y entre
//     pestañas (Web Locks). Dos drenados concurrentes solo generarian trafico
//     duplicado y carreras de orden.
//  4. ORDEN: los snapshots de catalogo van antes que los eventos que los
//     referencian, y los eventos salen en el orden en que ocurrieron (una
//     venta siempre antes de su anulacion).
//  5. NADA SE BORRA POR FALLAR: un error permanente (400/409/...) deja la
//     operacion en la cola con backoff y visible como "bloqueada" — nunca se
//     descarta sola. Un corte de red o de sesion frena el drenado completo.
//  6. VISIBLE: cualquier fallo de almacenamiento o de red se refleja en
//     getSyncStatus() / subscribeSyncStatus().
// ---------------------------------------------------------------------------

const QUEUE_KEY = "miga_sync_queue";
const LOCK_NAME = "miga-sync-drain";
const BACKOFF_BASE_MS = 5000;
const BACKOFF_MAX_MS = 15 * 60 * 1000;
const RETRY_INTERVAL_MS = 30000;

// Snapshots de "estado completo": el mas nuevo reemplaza a los anteriores
// todavia pendientes (encolar 40 veces lo mismo no tiene sentido y llena el
// localStorage). Clave = tipo, o tipo:id para los que tienen id propio.
const SNAPSHOT_TYPES = new Set([
  "catalogo_snapshot", "insumos_snapshot", "recetas_snapshot",
  "proveedores_snapshot", "proveedor_insumos_snapshot", "variantes_grupos",
  "configuracion_compartida"
]);

// Orden de drenado: primero lo que otros datos referencian (FK).
const TIER = {
  catalogo_snapshot: 0,
  insumos_snapshot: 1, proveedores_snapshot: 1, variantes_grupos: 1,
  recetas_snapshot: 2, proveedor_insumos_snapshot: 2
};
const tierOf = (op) => TIER[op.type] ?? 3;

let storageError = false;
let lastError = null;
let lastSyncedAt = null;
let authBlocked = false;
let draining = null;
let rerun = false;
const listeners = new Set();

// ---- Persistencia ---------------------------------------------------------

function newOpId() {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

// La cola vive en memoria y localStorage es solo su respaldo durable. Sin este
// cache, cada cambio de estado (encolar, confirmar, reintentar, pintar el
// badge) releia y parseaba el JSON completo — que incluye snapshots de
// catalogo de varios KB. Se invalida cuando OTRA pestaña la modifica (evento
// "storage"), asi que compartir la cola entre pestañas sigue funcionando.
let colaEnMemoria = null;

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === QUEUE_KEY || e.key === null) { colaEnMemoria = null; notify(); }
  });
}

function readStored() {
  if (colaEnMemoria) return colaEnMemoria;
  try {
    const parsed = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
    colaEnMemoria = Array.isArray(parsed) ? parsed : [];
  } catch { colaEnMemoria = []; }
  return colaEnMemoria;
}

function writeStored(ops) {
  colaEnMemoria = ops;
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(ops));
    storageError = false;
    return true;
  } catch {
    storageError = true;
    return false;
  }
}

// Si localStorage esta lleno, la cola SIGUE completa en memoria (no se pierde
// nada mientras la pestaña viva), storageError avisa en el badge, y el proximo
// guardado exitoso la persiste entera. Las operaciones heredadas de versiones
// anteriores (sin id) reciben uno al leerse.
function loadQueue() {
  const stored = readStored();
  let migrated = false;
  for (const op of stored) {
    if (!op.id) { op.id = newOpId(); migrated = true; }
  }
  if (migrated) writeStored(stored);
  return stored;
}

// Lectura-modificacion-escritura sincrona (JS no se interrumpe dentro de una
// funcion sincrona, asi que no hay ventana de carrera dentro de la pestaña).
function mutateQueue(mutator) {
  const all = loadQueue();
  const next = mutator(all);
  writeStored(next);
  notify();
  return next;
}

function coalesceKey(op) {
  if (!SNAPSHOT_TYPES.has(op.type)) return null;
  return op.type === "configuracion_compartida" ? `${op.type}:${op.payload?.id}` : op.type;
}

function enqueue(op) {
  const entry = { ...op, id: newOpId(), enqueuedAt: new Date().toISOString(), attempts: 0, nextTryAt: 0 };
  const key = coalesceKey(entry);
  mutateQueue((q) => {
    const base = key ? q.filter((o) => coalesceKey(o) !== key) : q;
    return base.concat(entry);
  });
  return entry.id;
}

function removeOps(ids) {
  if (ids.size === 0) return;
  mutateQueue((q) => q.filter((o) => !ids.has(o.id)));
}

function patchOp(id, patch) {
  mutateQueue((q) => q.map((o) => (o.id === id ? { ...o, ...patch } : o)));
}

// ---- Estado observable ----------------------------------------------------

export function getPendingSyncCount() {
  return loadQueue().length;
}

export function getSyncStatus() {
  const q = loadQueue();
  const now = Date.now();
  const blocked = q.filter((o) => (o.attempts || 0) >= 3 && (o.nextTryAt || 0) > now).length;
  return {
    pending: q.length,
    blocked,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    draining: draining != null,
    lastError,
    lastSyncedAt,
    storageError,
    authBlocked
  };
}

export function subscribeSyncStatus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  if (listeners.size === 0) return;
  const status = getSyncStatus();
  for (const fn of listeners) {
    try { fn(status); } catch { /* un listener roto no frena el sync */ }
  }
}

// uuids de ventas que todavia no llegaron a la nube (para marcarlas en el
// Historial). Una venta anulada pendiente tambien cuenta como pendiente.
export function getPendingVentaUuids() {
  const out = new Set();
  for (const op of loadQueue()) {
    if (op.type === "venta" && op.payload?.venta?.uuid) out.add(op.payload.venta.uuid);
    if (op.type === "venta_anulada" && op.payload?.uuid) out.add(op.payload.uuid);
  }
  return out;
}

// ---- Ejecucion ------------------------------------------------------------

async function executeOp(op) {
  switch (op.type) {
    case "venta":
      return pushVenta(op.payload);
    case "calibracion":
      return pushCalibracion(op.payload);
    case "catalogo_snapshot":
      return pushCatalogoSnapshot(op.payload.categorias, op.payload.productos);
    case "insumos_snapshot":
      return pushInsumosSnapshot(op.payload);
    case "recetas_snapshot":
      return pushRecetasSnapshot(op.payload);
    case "movimientos_insumos":
      return pushMovimientosInsumos(op.payload);
    // Nada nuevo encola estos dos tipos (ver migraciones 004 y 010: tanto
    // stock_productos como produccion_diaria ahora se calculan solos en
    // Supabase a partir de movimientos_stock). Se dejan los casos para drenar
    // en paz lo que ya estuviera en la cola local de algun dispositivo al
    // momento del deploy.
    case "stock_productos":
      return pushStockProductos(op.payload);
    case "produccion_diaria":
      return pushProduccionDiaria(op.payload);
    case "proveedores_snapshot":
      return pushProveedoresSnapshot(op.payload);
    case "proveedor_insumos_snapshot":
      return pushProveedorInsumosSnapshot(op.payload);
    case "movimiento_stock":
      return pushMovimientoStock(op.payload);
    case "venta_anulada":
      return updateVentaAnulada(op.payload);
    case "variantes_grupos":
      return pushVariantesGrupos(op.payload);
    case "historial_receta":
      return pushHistorialReceta(op.payload);
    case "configuracion_compartida":
      return pushConfiguracionCompartida(op.payload.id, op.payload.valor);
    default:
      throw new Error(`Tipo de sync desconocido: ${op.type}`);
  }
}

// "network": no hubo respuesta (sin wifi, timeout) -> frena el drenado, no
//            tiene sentido seguir pegandole a un servidor inalcanzable.
// "auth":    sesion vencida/rechazada -> frena, hace falta volver a loguear.
// "retry":   cualquier otro fallo -> esta operacion espera con backoff pero
//            las demas siguen (una operacion rota no bloquea a las sanas).
function classify(error) {
  // Solo lo que sbFetch marca como fallo de red. Un TypeError comun es un bug
  // de codigo en ESA operacion y no tiene que frenar a las demas.
  if (error?.network) return "network";
  if (error?.status === 401 || error?.status === 403) return "auth";
  return "retry";
}

function backoffMs(attempts) {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1));
}

async function drainOnce(force) {
  const online = typeof navigator === "undefined" ? true : navigator.onLine;
  if (!online) return { synced: 0, pending: getPendingSyncCount(), offline: true };

  const snapshot = loadQueue();
  if (snapshot.length === 0) { authBlocked = false; return { synced: 0, pending: 0 }; }

  const now = Date.now();
  // sort estable: dentro de cada nivel se conserva el orden de llegada
  const due = snapshot
    .filter((op) => force || (op.nextTryAt || 0) <= now)
    .map((op, i) => ({ op, i }))
    .sort((a, b) => tierOf(a.op) - tierOf(b.op) || a.i - b.i)
    .map((x) => x.op);

  const done = new Set();
  let stoppedBy = null;
  for (const op of due) {
    try {
      await executeOp(op);
      done.add(op.id);
      lastSyncedAt = new Date().toISOString();
      authBlocked = false;
    } catch (error) {
      const kind = classify(error);
      lastError = { type: op.type, message: error?.message || String(error), at: new Date().toISOString() };
      console.warn("[sync] fallo:", op.type, kind, lastError.message);
      if (kind === "network") { stoppedBy = "network"; break; }
      if (kind === "auth") { authBlocked = true; stoppedBy = "auth"; break; }
      const attempts = (op.attempts || 0) + 1;
      patchOp(op.id, { attempts, nextTryAt: Date.now() + backoffMs(attempts), lastError: lastError.message.slice(0, 300) });
    }
  }

  removeOps(done);
  const pending = getPendingSyncCount();
  if (pending === 0) lastError = null;
  return { synced: done.size, pending, lastError, stoppedBy };
}

// Punto de entrada unico de drenado. Si ya hay uno en curso, no arranca otro:
// pide una pasada extra (por si se encolo algo mientras) y devuelve la misma
// promesa. Entre pestañas usa Web Locks cuando el navegador lo soporta.
export function processSyncQueue({ force = false } = {}) {
  if (draining) { rerun = true; return draining; }

  draining = (async () => {
    let total = { synced: 0, pending: 0 };
    try {
      do {
        rerun = false;
        const run = () => drainOnce(force);
        const result = navigator.locks?.request
          ? await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) => (lock ? run() : { synced: 0, pending: getPendingSyncCount(), busyElsewhere: true }))
          : await run();
        total = { ...result, synced: total.synced + (result.synced || 0) };
        if (result.offline || result.stoppedBy || result.busyElsewhere) break;
      } while (rerun);
    } finally {
      draining = null;
      rerun = false;
      notify();
    }
    return total;
  })();
  notify();
  return draining;
}

// Persistir primero, despues drenar. Devuelve true si ESTA operacion ya esta
// en la nube al terminar, false si quedo en la cola (offline / error).
async function tryNow(op) {
  const id = enqueue(op);
  await processSyncQueue().catch(() => {});
  return !loadQueue().some((o) => o.id === id);
}

export function trySyncVenta(payload) {
  return tryNow({ type: "venta", payload });
}

export function trySyncCalibracion(payload) {
  return tryNow({ type: "calibracion", payload });
}

export function trySyncCatalogoSnapshot(categorias, productos) {
  return tryNow({ type: "catalogo_snapshot", payload: { categorias, productos } });
}

export function trySyncInsumosSnapshot(insumos) {
  return tryNow({ type: "insumos_snapshot", payload: insumos });
}

export function trySyncRecetasSnapshot(recetas) {
  return tryNow({ type: "recetas_snapshot", payload: recetas });
}

export function trySyncProveedoresSnapshot(proveedores) {
  return tryNow({ type: "proveedores_snapshot", payload: proveedores });
}

export function trySyncProveedorInsumosSnapshot(proveedorInsumos) {
  return tryNow({ type: "proveedor_insumos_snapshot", payload: proveedorInsumos });
}

export function trySyncMovimientosInsumos(movimientos) {
  return tryNow({ type: "movimientos_insumos", payload: movimientos });
}

// No hay trySyncProduccionDiaria: nada crea mas ops de este tipo (ver
// migracion 010 — produccion_diaria se calcula sola en Supabase a partir de
// movimientos_stock). El caso "produccion_diaria" sigue en executeOp() de
// arriba solo para drenar en paz lo que ya estuviera encolado localmente en
// algun dispositivo al momento de este deploy.

// Movimiento individual (con hora) para que "modo consulta" pueda mostrar
// "a que hora" se cargo cada produccion, igual que en la tablet.
export function trySyncMovimientoStock(movimiento) {
  return tryNow({ type: "movimiento_stock", payload: movimiento });
}

export function trySyncVentaAnulada({ uuid, fecha, creadoEn }) {
  return tryNow({ type: "venta_anulada", payload: { uuid, fecha, creadoEn } });
}

export function trySyncVariantesGrupos(grupos) {
  return tryNow({ type: "variantes_grupos", payload: grupos });
}

export function trySyncHistorialReceta(evento) {
  return tryNow({ type: "historial_receta", payload: evento });
}

export function trySyncConfiguracionCompartida(id, valor) {
  return tryNow({ type: "configuracion_compartida", payload: { id, valor } });
}

// Reintentos automaticos: al volver la conexion, al volver a la pestaña, y un
// intervalo corto. El evento "online" solo salta si el navegador llega a
// considerarse offline — un push que falla por otro motivo (timeout, wifi
// debil que nunca tira la conexion del todo) queda encolado y ese evento
// nunca vuelve a saltar. El intervalo cubre ese caso; el backoff por
// operacion evita martillar al servidor.
let autoSyncIntervalId = null;
let autoSyncInstalled = false;

export function setupAutoSync() {
  if (!autoSyncInstalled) {
    autoSyncInstalled = true;
    window.addEventListener("online", () => {
      console.log("[sync] Conexión recuperada — procesando cola...");
      notify();
      processSyncQueue({ force: true }).catch(console.error);
    });
    window.addEventListener("offline", notify);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && getPendingSyncCount() > 0) processSyncQueue().catch(() => {});
    });
  }

  if (autoSyncIntervalId != null) window.clearInterval(autoSyncIntervalId);
  autoSyncIntervalId = window.setInterval(() => {
    if (!navigator.onLine || getPendingSyncCount() === 0) return;
    processSyncQueue().catch(() => {});
  }, RETRY_INTERVAL_MS);

  // Lo que haya quedado de la sesion anterior sale apenas arranca la app.
  if (getPendingSyncCount() > 0) processSyncQueue().catch(() => {});
}
