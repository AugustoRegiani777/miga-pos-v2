// A que base de datos (proyecto de Supabase) pertenece lo que hay guardado en
// ESTE dispositivo.
//
// Cada dispositivo guarda todo su estado localmente (IndexedDB: productos, stock,
// ventas; localStorage: la cola de envios pendientes y la sesion). Si la app pasa
// a hablar con OTRA base de datos (ej. se empieza de cero con una base nueva) y
// el dispositivo conserva lo de la anterior, pasan dos cosas malas: lo viejo se
// sigue mostrando como si fuera de la base nueva, y la cola de pendientes sube
// ventas viejas a la base nueva y la ensucia justo lo que se queria evitar.
//
// Por eso cada dispositivo anota con que base trabajo (MARCA). Al arrancar, si la
// marca no coincide con la base actual — o no existe, que es lo que pasa con un
// dispositivo de una version anterior que todavia no la escribia — lo local se
// borra ANTES de que arranque nada que pueda enviar o leer datos, y se empieza
// limpio. En un dispositivo nuevo (sin marca y sin datos) no hay nada que borrar.

const MARCA = "miga_base_ref";
// Preferencias del dispositivo, no datos de la base: sobreviven al reinicio.
const CONSERVAR = new Set([MARCA, "miga_modo_consulta", "miga_tema"]);
const NOMBRE_IDB = "miga-pos-local";

// "https://abcd1234.supabase.co" -> "abcd1234"
export function refDeBase(url) {
  try { return new URL(url).hostname.split(".")[0]; }
  catch { return String(url || ""); }
}

function borrarBaseLocal() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return resolve();
    const pedido = indexedDB.deleteDatabase(NOMBRE_IDB);
    pedido.onsuccess = () => resolve();
    pedido.onerror = () => reject(pedido.error || new Error("No se pudo reiniciar este dispositivo."));
    // Otra pestana de la app (con el codigo viejo) tiene la base abierta: no se
    // puede borrar mientras tanto. Se avisa en vez de seguir y mezclar datos.
    pedido.onblocked = () => reject(new Error("Hay otra ventana de la app abierta. Cerrala y volvé a abrir."));
  });
}

// Devuelve { reiniciado } — true si habia datos de otra base y se borraron.
export async function asegurarMismaBase(refActual) {
  let guardada;
  try { guardada = localStorage.getItem(MARCA); }
  catch { return { reiniciado: false }; } // sin localStorage no hay estado que proteger
  if (guardada === refActual) return { reiniciado: false };

  let habiaAlgo = false;
  try {
    for (const clave of Object.keys(localStorage)) {
      if (clave.startsWith("miga_") && !CONSERVAR.has(clave)) { localStorage.removeItem(clave); habiaAlgo = true; }
    }
  } catch { /* se sigue con lo que se pueda */ }

  if (typeof indexedDB !== "undefined" && typeof indexedDB.databases === "function") {
    const dbs = await indexedDB.databases().catch(() => []);
    if (dbs.some((db) => db.name === NOMBRE_IDB)) habiaAlgo = true;
  } else habiaAlgo = true;

  await borrarBaseLocal();
  try { localStorage.setItem(MARCA, refActual); } catch { /* ignorar */ }
  return { reiniciado: habiaAlgo };
}
