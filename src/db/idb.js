import { DB_NAME, DB_VERSION, STORE_NAMES, initialCategories, initialProducts } from "../modules/seed.js";

let dbPromise;
let dbInstance;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Transaccion cancelada."));
  });
}

function createStores(db) {
  if (!db.objectStoreNames.contains("categorias")) {
    db.createObjectStore("categorias", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("productos")) {
    const store = db.createObjectStore("productos", { keyPath: "id" });
    store.createIndex("categoriaId", "categoriaId", { unique: false });
  }
  if (!db.objectStoreNames.contains("produccion_diaria")) {
    const store = db.createObjectStore("produccion_diaria", { keyPath: "id" });
    store.createIndex("fecha", "fecha", { unique: false });
    store.createIndex("productoFecha", ["productoId", "fecha"], { unique: true });
  }
  if (!db.objectStoreNames.contains("ventas")) {
    const store = db.createObjectStore("ventas", { keyPath: "id", autoIncrement: true });
    store.createIndex("fecha", "fecha", { unique: false });
  }
  if (!db.objectStoreNames.contains("detalle_venta")) {
    const store = db.createObjectStore("detalle_venta", { keyPath: "id", autoIncrement: true });
    store.createIndex("ventaId", "ventaId", { unique: false });
    store.createIndex("fecha", "fecha", { unique: false });
  }
  if (!db.objectStoreNames.contains("movimientos_stock")) {
    const store = db.createObjectStore("movimientos_stock", { keyPath: "id", autoIncrement: true });
    store.createIndex("productoId", "productoId", { unique: false });
    store.createIndex("fecha", "fecha", { unique: false });
  }
  if (!db.objectStoreNames.contains("configuracion")) {
    db.createObjectStore("configuracion", { keyPath: "id" });
  }
  if (!db.objectStoreNames.contains("cierres_diarios")) {
    const store = db.createObjectStore("cierres_diarios", { keyPath: "id" });
    store.createIndex("fecha", "fecha", { unique: true });
  }
}

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => createStores(request.result);
    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = undefined;
        dbPromise = undefined;
      };
      dbInstance.onclose = () => {
        dbInstance = undefined;
        dbPromise = undefined;
      };
      resolve(dbInstance);
    };
    request.onerror = () => {
      dbPromise = undefined;
      reject(request.error);
    };
    request.onblocked = () => {
      console.warn("La base de datos quedo bloqueada por otra instancia abierta.");
    };
  });

  return dbPromise;
}

export function resetDatabaseConnection() {
  if (dbInstance) {
    dbInstance.close();
  }
  dbInstance = undefined;
  dbPromise = undefined;
}

export async function seedDatabase() {
  const db = await openDatabase();
  const currentProducts = await requestToPromise(
    db.transaction("productos", "readonly").objectStore("productos").getAll()
  );
  const tx = db.transaction(["categorias", "productos", "configuracion"], "readwrite");
  const now = new Date().toISOString();
  const categoryStore = tx.objectStore("categorias");
  const productStore = tx.objectStore("productos");
  const currentById = new Map(currentProducts.map((product) => [product.id, product]));
  const catalogIds = new Set(initialProducts.map((product) => product.id));

  for (const category of initialCategories) {
    categoryStore.put({ ...category, creadoEn: now });
  }

  for (const product of initialProducts) {
    const current = currentById.get(product.id);
    productStore.put({
      ...product,
      ...current,
      categoriaId: product.categoriaId,
      nombre: product.nombre,
      precioCentavos: product.precioCentavos,
      umbralBajo: product.umbralBajo,
      controlaStock: product.controlaStock,
      orden: product.orden,
      activo: product.activo,
      sandwichTipo: product.sandwichTipo,
      stockActual: current?.stockActual ?? product.stockActual,
      creadoEn: current?.creadoEn ?? now,
      actualizadoEn: now
    });
  }

  for (const current of currentProducts) {
    if (!catalogIds.has(current.id) && current.activo) {
      productStore.put({ ...current, activo: false, actualizadoEn: now });
    }
  }

  tx.objectStore("configuracion").put({ id: "seeded_v2", valor: true, actualizadoEn: now });
  await transactionDone(tx);
}

export async function getAll(storeName) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}

export async function getOne(storeName, key) {
  const db = await openDatabase();
  return requestToPromise(db.transaction(storeName, "readonly").objectStore(storeName).get(key));
}

export async function putOne(storeName, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(value);
  await transactionDone(tx);
  return value;
}

export async function replaceStore(storeName, rows) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  store.clear();
  for (const row of rows) store.put(row);
  await transactionDone(tx);
}

export async function exportAllData() {
  const data = {};
  for (const storeName of STORE_NAMES) {
    data[storeName] = await getAll(storeName);
  }
  return {
    app: "Miga POS PWA",
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    data
  };
}

export async function importAllData(payload) {
  if (!payload || payload.app !== "Miga POS PWA" || !payload.data) {
    throw new Error("El archivo no parece ser un backup valido de Miga POS.");
  }
  for (const storeName of STORE_NAMES) {
    if (payload.data[storeName] !== undefined && !Array.isArray(payload.data[storeName])) {
      throw new Error(`El backup tiene datos invalidos en ${storeName}.`);
    }
  }

  const db = await openDatabase();
  const tx = db.transaction(STORE_NAMES, "readwrite");
  for (const storeName of STORE_NAMES) {
    const store = tx.objectStore(storeName);
    store.clear();
    for (const row of payload.data[storeName] || []) store.put(row);
  }
  await transactionDone(tx);
}

export async function withStores(storeNames, mode, callback) {
  const db = await openDatabase();
  const tx = db.transaction(storeNames, mode);
  const stores = Object.fromEntries(storeNames.map((name) => [name, tx.objectStore(name)]));
  const result = await callback(stores, tx);
  await transactionDone(tx);
  return result;
}

export { requestToPromise };
