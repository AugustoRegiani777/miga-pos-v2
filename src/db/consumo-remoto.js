// Baja de la nube la SERIE DE CONSUMO DIARIO por insumo y la deja guardada
// para usarla sin internet.
//
// Por que existe: el sync del ledger es solo de SUBIDA. Se baja el catalogo
// (pullInsumosDesdeNube, pullCatalogoDesdeNube) y los totales derivados de
// stock (reconciliarStockInsumosConNube), pero nunca el historial de
// movimientos. Medido hoy contra staging: un dispositivo que no genero la
// historia tiene movimientos_insumos = 0 en local contra 587 en la nube. Sin
// esa serie no hay forma de estimar cuanto se gasta por dia de nada, y el
// modelo de compras se queda sin su insumo principal.
//
// Esto es SOLO LECTURA: no escribe nada en Supabase. Lo unico que escribe es
// una fila en la store local `configuracion` (mismo patron clave-valor que ya
// usa combos.js), para que la serie siga disponible sin conexion.

import { getOne, withStores } from "./idb.js";
import { sbFetchConCuenta } from "./supabase.js";
import { todayISO } from "../utils/format.js";

// Que cuenta como CONSUMO. Los tipos validos de movimientos_insumos son
// ('compra','desperdicio','no_recibido','error_conteo','produccion','venta',
// 'devolucion','calibracion') — ver el CHECK de la tabla en
// sql/staging/supabase-schema-staging.sql. De todos esos, solo tres hablan de
// lo que se gasto por dia:
//   - venta / produccion: el gasto real del negocio.
//   - desperdicio: tambien se gasto (se tiro), y hay que reponerlo igual.
// Los otros quedan afuera a proposito:
//   - compra y no_recibido son reposicion (o su correccion), no gasto;
//   - calibracion y error_conteo son correcciones de CONTEO — meterlas hace
//     que un recuento mal hecho se lea como si se hubiera consumido de mas, y
//     ensucia la tasa justo en los dias en que se calibra.
export const TIPOS_CONSUMO = ["venta", "produccion", "desperdicio"];

// Ventana por defecto: 8 semanas. Suficiente para una EMA estable y para ver
// el dia de semana repetido 8 veces, sin bajar historia que ya no representa
// al negocio de hoy.
export const DIAS_SERIE_CONSUMO = 56;

// Clave de la store `configuracion` donde queda la copia offline.
export const SERIE_CONSUMO_CONFIG_ID = "serie_consumo_insumos";

// PostgREST corta cada respuesta en 1000 filas SIN avisar. Hoy hay 587
// movimientos y crecen todos los dias: el dia que haya 1200, una sola
// consulta devolveria 1000 y el modelo quedaria corto en silencio. Se pagina
// por cursor de id (keyset), igual que fetchAllPorId en supabase.js — estable
// aunque entren filas nuevas mientras se baja, a diferencia de un offset.
const PAGE_SIZE = 1000;

// Tope de seguridad: ~500k filas. No es un limite esperable, es para que un
// bug (un cursor que no avanza) no deje el arranque girando para siempre.
const MAX_PAGINAS = 500;

const esFechaISO = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""));

// Aritmetica pura sobre los numeros de la fecha, en UTC de punta a punta —
// mismo motivo que avanzarFechaSimulada() en format.js: mezclar getters
// locales con Date.UTC corre la fecha segun la zona horaria del dispositivo.
function restarDias(fechaISO, dias) {
  const [year, month, day] = fechaISO.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day - dias));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function redondear(n) {
  return Math.round(n * 10000) / 10000;
}

// --- Lectura remota (paginada) ----------------------------------------------

// Devuelve { filas, cuentaRemota }. cuentaRemota es la cuenta EXACTA que
// reporta Postgres para el filtro completo (cabecera Content-Range de la
// primera pagina, donde el cursor todavia no descarto nada): sirve para
// comprobar que lo que se bajo es todo lo que habia y no una pagina sola.
async function bajarMovimientosConsumo({ desde, hasta }) {
  const tipos = TIPOS_CONSUMO.join(",");
  const filas = [];
  let ultimoId = 0;
  let cuentaRemota = null;

  for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
    const path = `/movimientos_insumos?select=id,insumo_id,cantidad,fecha`
      + `&tipo=in.(${tipos})`
      + `&fecha=gte.${desde}&fecha=lte.${hasta}`
      + `&id=gt.${ultimoId}&order=id.asc&limit=${PAGE_SIZE}`;
    const { filas: page, cuenta } = await sbFetchConCuenta(path);
    if (pagina === 0) cuentaRemota = cuenta;
    if (!page || page.length === 0) break;
    filas.push(...page);
    const siguiente = page[page.length - 1].id;
    // Si el cursor no avanza, cortar: seguir pidiendo la misma pagina seria
    // un bucle infinito.
    if (!(siguiente > ultimoId)) break;
    ultimoId = siguiente;
    // Se corta solo con una pagina VACIA, no con una "corta": el servidor
    // puede tener un tope de filas por respuesta mas chico que PAGE_SIZE, y
    // una pagina corta no significa que ya no haya mas.
  }

  return { filas, cuentaRemota };
}

// --- Agregacion del lado del cliente ---------------------------------------

// De las filas crudas a la serie compacta. Son muchas menos filas (una por
// insumo y dia, no una por movimiento) y es lo unico que se usa.
//
// Signo: en movimientos_insumos `cantidad` es un DELTA de stock (el trigger de
// stock_insumos lo suma tal cual), asi que el consumo viene NEGATIVO. Aca se
// invierte para devolver cuanto se GASTO, en positivo.
//
// Se agrega por neto del dia: un movimiento positivo del mismo tipo es una
// correccion (ej. se bajo la produccion del dia y devolvio insumo al stock) y
// tiene que restar del gasto de ese dia, no sumarlo. Si el neto de un dia
// queda en cero o negativo, ese dia no aporto gasto y no entra en la serie.
export function agregarConsumoPorInsumoYFecha(filas) {
  const acumulado = new Map();
  for (const fila of filas || []) {
    const insumoId = fila?.insumo_id;
    const fecha = fila?.fecha;
    const delta = Number(fila?.cantidad);
    if (!insumoId || !esFechaISO(fecha) || !Number.isFinite(delta)) continue;
    const clave = `${insumoId}\u0000${fecha}`;
    acumulado.set(clave, (acumulado.get(clave) || 0) - delta);
  }

  const serie = [];
  for (const [clave, cantidad] of acumulado) {
    const gastado = redondear(cantidad);
    if (!(gastado > 0)) continue;
    const [insumoId, fecha] = clave.split("\u0000");
    serie.push({ insumoId, fecha, cantidad: gastado });
  }
  serie.sort((a, b) => (a.insumoId === b.insumoId
    ? a.fecha.localeCompare(b.fecha)
    : a.insumoId.localeCompare(b.insumoId)));
  return serie;
}

// Comodidad para quien calcula tasas: { insumoId: [{ fecha, cantidad }, ...] }
// ya ordenado por fecha. Funcion pura, no toca ni red ni IDB.
export function agruparSeriePorInsumo(serie) {
  const porInsumo = new Map();
  for (const punto of serie || []) {
    if (!porInsumo.has(punto.insumoId)) porInsumo.set(punto.insumoId, []);
    porInsumo.get(punto.insumoId).push({ fecha: punto.fecha, cantidad: punto.cantidad });
  }
  for (const puntos of porInsumo.values()) puntos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return porInsumo;
}

// --- Copia offline en IndexedDB --------------------------------------------

async function guardarSerieLocal(payload) {
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: SERIE_CONSUMO_CONFIG_ID, ...payload });
  });
}

// Lo ultimo que se bajo, sin tocar la red. Lo exporta el modulo para que
// quien consuma la serie no tenga que saber de donde salio.
// Nunca tira: si no hay nada guardado devuelve una serie vacia.
export async function leerSerieConsumoLocal() {
  try {
    const row = await getOne("configuracion", SERIE_CONSUMO_CONFIG_ID);
    if (!row || !Array.isArray(row.serie)) {
      return { serie: [], desde: null, hasta: null, dias: null, actualizadoEn: null, origen: "vacio" };
    }
    return {
      serie: row.serie,
      desde: row.desde || null,
      hasta: row.hasta || null,
      dias: row.dias ?? null,
      filasLeidas: row.filasLeidas ?? null,
      cuentaRemota: row.cuentaRemota ?? null,
      actualizadoEn: row.actualizadoEn || null,
      origen: "local"
    };
  } catch {
    return { serie: [], desde: null, hasta: null, dias: null, actualizadoEn: null, origen: "vacio" };
  }
}

// --- API principal ----------------------------------------------------------

// Baja la serie de la nube, la guarda en local y la devuelve con su metadata.
//
// Offline-first y a prueba de arranque: un fallo de red (o un rechazo del
// servidor) NO se propaga — se devuelve lo ultimo que se habia bajado y la
// app sigue. El que llama puede mirar `origen` ("nube" | "local" | "vacio")
// y `error` si quiere avisar algo en pantalla.
//
// `hasta` (YYYY-MM-DD, por defecto hoy) es el ultimo dia INCLUIDO, y `dias`
// cuenta ese dia: dias = 56 y hasta = "2026-10-05" → desde "2026-08-11".
export async function sincronizarSerieConsumo({ hasta, dias = DIAS_SERIE_CONSUMO } = {}) {
  const fin = esFechaISO(hasta) ? hasta : todayISO();
  const ventana = Math.max(1, Math.round(Number(dias) || DIAS_SERIE_CONSUMO));
  const inicio = restarDias(fin, ventana - 1);

  let filas;
  let cuentaRemota;
  try {
    ({ filas, cuentaRemota } = await bajarMovimientosConsumo({ desde: inicio, hasta: fin }));
  } catch (error) {
    const local = await leerSerieConsumoLocal();
    return { ...local, error: error?.message || String(error) };
  }

  const serie = agregarConsumoPorInsumoYFecha(filas);
  const payload = {
    desde: inicio,
    hasta: fin,
    dias: ventana,
    tipos: TIPOS_CONSUMO,
    serie,
    filasLeidas: filas.length,
    cuentaRemota: cuentaRemota ?? null,
    actualizadoEn: new Date().toISOString()
  };

  // Que falle guardar la copia offline no invalida la serie que ya se bajo.
  try { await guardarSerieLocal(payload); }
  catch { /* IDB lleno o store no disponible — se devuelve igual */ }

  return { ...payload, origen: "nube" };
}

// Firma pedida por el modelo de compras: devuelve solo la serie.
// [{ insumoId, fecha: "YYYY-MM-DD", cantidad }] con cantidad POSITIVA (lo
// gastado ese dia). Sin internet devuelve la ultima copia bajada.
export async function fetchSerieConsumo({ hasta, dias = DIAS_SERIE_CONSUMO } = {}) {
  const { serie } = await sincronizarSerieConsumo({ hasta, dias });
  return serie;
}
