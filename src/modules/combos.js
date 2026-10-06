import { getOne, withStores } from "../db/idb.js";
import { fetchConfiguracionCompartida } from "../db/supabase.js";
import { trySyncConfiguracionCompartida } from "./sync.js";
import { setCombosConfig, getCombosConfig, DEFAULT_COMBOS_CONFIG } from "./pricing.js";

// Precio de las promos por docena/media docena — antes vivian fijas en
// pricing.js, ahora se editan desde Gestion > Menu (ver render en app.js) y
// viajan en configuracion_compartida, la misma tabla que ya usan los
// comentarios de produccion y los grupos de variante: una sola fila con id
// fijo, no un ledger — no hace falta uuid como en CLAUDE.md 8.7 (eso es para
// filas que se puedan reintentar y duplicar; aca cada guardado reemplaza a
// la fila anterior a proposito).
const CONFIG_ID = "combos_sandwich";

function normalizar(valor) {
  const centavos = (x, porDefecto) => {
    const n = Math.round(Number(x));
    return Number.isFinite(n) && n >= 0 ? n : porDefecto;
  };
  return {
    docePrecioCentavos: centavos(valor?.docePrecioCentavos, DEFAULT_COMBOS_CONFIG.docePrecioCentavos),
    seisPrecioCentavos: centavos(valor?.seisPrecioCentavos, DEFAULT_COMBOS_CONFIG.seisPrecioCentavos),
    premiumExtraCentavos: centavos(valor?.premiumExtraCentavos, DEFAULT_COMBOS_CONFIG.premiumExtraCentavos)
  };
}

// Se llama en bootApp, ANTES de que Caja o Pedidos calculen ningun precio —
// aplica a pricing.js lo que este dispositivo tenia guardado (si nunca se
// edito, pricing.js ya arranca con el default de siempre).
export async function cargarCombosConfigLocal() {
  const row = await getOne("configuracion", CONFIG_ID);
  if (row?.valor) setCombosConfig(normalizar(row.valor));
}

export function getCombosConfigActual() {
  return getCombosConfig();
}

// Guarda un valor nuevo: local primero (offline-first, la promo sigue
// funcionando aunque no haya internet en el momento de guardarla), lo aplica
// a pricing.js al toque, y sincroniza fire-and-forget.
export async function guardarCombosConfig(valorCrudo) {
  const valor = normalizar(valorCrudo);
  const now = new Date().toISOString();
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor, actualizadoEn: now });
  });
  setCombosConfig(valor);
  trySyncConfiguracionCompartida(CONFIG_ID, valor).catch(() => {});
  return valor;
}

// Trae lo que haya en la nube (por si se edito desde otro dispositivo) — se
// llama desde "Actualizar catalogo", igual que pullVariantesGruposDesdeNube.
export async function pullCombosConfigDesdeNube() {
  const row = await fetchConfiguracionCompartida(CONFIG_ID).catch(() => null);
  if (!row?.valor) return false;
  const valor = normalizar(row.valor);
  const now = new Date().toISOString();
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CONFIG_ID, valor, actualizadoEn: now });
  });
  setCombosConfig(valor);
  return true;
}
