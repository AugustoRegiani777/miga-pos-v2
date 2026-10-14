import { getOne, withStores } from "../db/idb.js";
import { fetchConfiguracionCompartida } from "../db/supabase.js";
import { trySyncConfiguracionCompartida } from "./sync.js";

// Merma de compra: parte de lo que entra que NO se usa (el cuero y la piel de la pata de serrano,
// los restos de una barra de gouda, el liquido de las aceitunas). Se guarda como un porcentaje por
// insumo. Cada compra suma lo que entra y resta la merma como un renglon aparte del historial
// (tipo "desperdicio"), asi el stock queda con lo UTIL y el historial cuenta toda la historia.
//
// El porcentaje arranca como una estimacion y se corrige midiendo cortes reales (registrarCorte):
// pasa a ser el rendimiento de los ultimos cortes. Viaja en configuracion_compartida (una sola fila,
// como los combos y las variantes), asi que no hace falta tocar la base de datos.
const CONFIG_ID = "mermas_insumos";
const CORTES_QUE_SE_PROMEDIAN = 5;

function normalizar(valor) {
  const out = {};
  for (const [id, m] of Object.entries(valor || {})) {
    const pct = Number(m?.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct >= 90) continue;
    const mediciones = Array.isArray(m?.mediciones)
      ? m.mediciones.filter((x) => Number(x?.entra) > 0 && Number(x?.util) >= 0 && Number(x.util) <= Number(x.entra))
      : [];
    out[id] = { pct: Math.round(pct * 100) / 100, mediciones };
  }
  return out;
}

export async function getMermas() {
  const row = await getOne("configuracion", CONFIG_ID);
  return normalizar(row?.valor);
}

export function pctDeMerma(mermas, insumoId) {
  return mermas?.[insumoId]?.pct || 0;
}

// Cuanto de lo comprado se pierde. Redondeado a 2 decimales (son gramos, ml o unidades).
export function cantidadDeMerma(comprado, pct) {
  if (!(comprado > 0) || !(pct > 0)) return 0;
  return Math.round(comprado * pct) / 100;
}

async function guardar(mermas) {
  const valor = normalizar(mermas);
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor, actualizadoEn: new Date().toISOString() });
  });
  trySyncConfiguracionCompartida(CONFIG_ID, valor).catch(() => {});
  return valor;
}

export async function guardarMerma(insumoId, pct) {
  const n = Number(String(pct).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n >= 90) throw new Error("La merma tiene que ser un porcentaje entre 0 y 90.");
  const mermas = await getMermas();
  if (n === 0) delete mermas[insumoId];
  else mermas[insumoId] = { pct: n, mediciones: mermas[insumoId]?.mediciones || [] };
  return guardar(mermas);
}

// Un corte real: "entro 5 kg, quedaron 4 kg utiles". El porcentaje pasa a ser el de los ultimos
// cortes juntos (total perdido / total que entro), no el de un solo dia.
export async function registrarCorte(insumoId, entra, util) {
  const e = Number(String(entra).replace(",", "."));
  const u = Number(String(util).replace(",", "."));
  if (!(e > 0) || !(u >= 0) || u > e) throw new Error("Anotá cuánto entró y cuánto quedó útil (lo útil no puede ser más que lo que entró).");
  const mermas = await getMermas();
  const mediciones = [...(mermas[insumoId]?.mediciones || []), { fecha: new Date().toISOString().slice(0, 10), entra: e, util: u }].slice(-CORTES_QUE_SE_PROMEDIAN);
  const entro = mediciones.reduce((s, x) => s + x.entra, 0);
  const quedo = mediciones.reduce((s, x) => s + x.util, 0);
  const pct = Math.round((1 - quedo / entro) * 10000) / 100;
  mermas[insumoId] = { pct, mediciones };
  await guardar(mermas);
  return { pct, cortes: mediciones.length };
}

export async function pullMermasDesdeNube() {
  const row = await fetchConfiguracionCompartida(CONFIG_ID).catch(() => null);
  if (!row?.valor) return false;
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor: normalizar(row.valor), actualizadoEn: new Date().toISOString() });
  });
  return true;
}
