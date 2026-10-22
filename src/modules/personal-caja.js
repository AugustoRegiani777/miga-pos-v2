import { getOne, withStores } from "../db/idb.js";
import { fetchConfiguracionCompartida } from "../db/supabase.js";
import { trySyncConfiguracionCompartida } from "./sync.js";

// Quien cuenta o cierra la caja. No hay un usuario por persona (un solo login del local): el nombre que se
// marca ES la trazabilidad. La lista viaja en configuracion_compartida (una fila) para que todos los
// dispositivos ofrezcan los mismos nombres.
const CONFIG_ID = "personal_caja";
const PREDETERMINADOS = ["Augusto", "Guá", "Sharon"];
const CLAVE_ULTIMO = "miga_caja_quien";

function normalizar(valor) {
  const nombres = (Array.isArray(valor) ? valor : []).map((n) => String(n || "").trim()).filter(Boolean);
  return [...new Set(nombres)].slice(0, 12);
}

export async function getPersonalCaja() {
  const row = await getOne("configuracion", CONFIG_ID);
  const guardados = normalizar(row?.valor);
  return guardados.length ? guardados : PREDETERMINADOS;
}

export async function agregarPersonaCaja(nombre) {
  const limpio = String(nombre || "").trim();
  if (!limpio) throw new Error("Escribí el nombre.");
  const lista = normalizar([...(await getPersonalCaja()), limpio]);
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor: lista, actualizadoEn: new Date().toISOString() });
  });
  trySyncConfiguracionCompartida(CONFIG_ID, lista).catch(() => {});
  return lista;
}

export async function pullPersonalCajaDesdeNube() {
  const row = await fetchConfiguracionCompartida(CONFIG_ID).catch(() => null);
  const lista = normalizar(row?.valor);
  if (!lista.length) return false;
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor: lista, actualizadoEn: new Date().toISOString() });
  });
  return true;
}

// El ultimo que conto en ESTE dispositivo: la proxima vez ya queda marcado.
export function ultimaPersonaCaja() {
  try { return localStorage.getItem(CLAVE_ULTIMO) || ""; } catch { return ""; }
}
export function recordarPersonaCaja(nombre) {
  try { localStorage.setItem(CLAVE_ULTIMO, nombre); } catch { /* sin localStorage */ }
}
