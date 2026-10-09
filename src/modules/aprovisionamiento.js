import { getAll, getOne, countAll, withStores, requestToPromise } from "../db/idb.js";
import { todayISO, slugify } from "../utils/format.js";
import { initialInsumos, initialRecetas, INSUMOS_SEED_VERSION, INSUMOS_OBSOLETOS_NOMBRES } from "./seed.js";
import { trySyncCalibracion, trySyncInsumosSnapshot, trySyncRecetasSnapshot, trySyncHistorialReceta, trySyncMovimientosInsumos, trySyncProveedorInsumosSnapshot, trySyncCatalogoSnapshot, getPendingSyncCount } from "./sync.js";
import { fetchInsumosCatalogo, fetchStockInsumos, deleteRecetaRemota, ENTORNO_DE_PRUEBA } from "../db/supabase.js";
import { estadoDeTodos, explicarEstado } from "./estado-stock.js";
import { demandaConocidaPorInsumo } from "./demanda-pedidos.js";
import { leerSerieConsumoLocal, sincronizarSerieConsumo } from "../db/consumo-remoto.js";
import { getGruposVariantes, saveGrupoVariante } from "./variantes.js";
import { sugerirCompra, clasificarUrgencia, variabilidadDiaria, tasaBaseDiaria,
         perfilSemanalDelLocal, perfilSemanalMezclado, alphaDiariaDesde } from "./compras-calculos.js";
import { serieDeConsumo } from "./estado-stock.js";


// Punto unico para "armar un insumo nuevo" — antes esta misma logica estaba
// copiada en menu.js, proveedores.js y facturas.js, cada una con su propia
// resolucion de id. idsUsados se pasa por referencia y esta funcion lo va
// completando: si se crean varios insumos nuevos en el mismo lote (ej. dos
// lineas de receta nuevas en un mismo producto), el segundo no puede
// colisionar con el id que acaba de resolver el primero.
export function construirInsumoNuevo(nombre, idsUsados, { unidad, unidadCompra, factorConversion, stockMinimo, stockCritico } = {}) {
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

  // El envase: con que nombre lo contas y cuanto trae cada uno. Sin envase
  // propio, el insumo se cuenta en su unidad base (factor 1) — es lo que
  // pasaba siempre antes, y dejaba insumos como "crema: g, de a g", que en la
  // vista se leian dos veces lo mismo. Un envase que traiga 1 o menos no es un
  // envase, asi que tampoco cuenta.
  const envaseNombre = String(unidadCompra || "").trim();
  const envaseTrae = parseFloat(String(factorConversion ?? "").replace(",", "."));
  const tieneEnvase = Boolean(envaseNombre) && Number.isFinite(envaseTrae) && envaseTrae > 1;

  return {
    id,
    nombre: nombreLimpio,
    unidad: unidadFinal,
    unidadCompra: tieneEnvase ? envaseNombre : unidadFinal,
    factorConversion: tieneEnvase ? envaseTrae : 1,
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
export async function createInsumo({ nombre, unidad, unidadCompra, factorConversion, stockMinimo, stockCritico }) {
  const insumosActuales = await getAll("insumos");
  const idsUsados = new Set(insumosActuales.map((i) => i.id));
  const insumo = construirInsumoNuevo(nombre, idsUsados, { unidad, unidadCompra, factorConversion, stockMinimo, stockCritico });

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
// Normalizacion de envases (v11). El envase de un insumo es "como lo contas
// vos", la unidad minima que contiene el producto a granel: una botella, una
// bolsa, un pote. NO es como te lo vende el proveedor (eso vive en
// proveedor_insumos, que puede traer una caja de 6 botellas).
//
// Antes habia insumos con el envase mal puesto: las leches decian "L" (que es
// una medida, no un envase, asi que la vista mostraba "5,93 L / 5,93 L"), y
// crema, salmon y leche de soja habian quedado con factor 1, o sea sin envase.
// Esta tabla los corrige una sola vez. Incluye insumos que NO estan en el seed
// (los creo el usuario en la app), porque el arreglo tiene que llegar al
// dispositivo: la copia local se sube al arrancar, asi que tocar solo la nube
// se pisaba solo.
//
// escalarPor esta para el unico caso que cambia de unidad base: la leche de
// soja se media en L y pasa a ml, asi que sus cantidades se multiplican x1000
// (stock, minimos y las recetas que la usan). Sin eso, 3 L de minimo pasarian
// a leerse como 3 ml.
const ENVASES_NORMALIZADOS_V11 = {
  "leche-normal":      { unidadCompra: "botella", factorConversion: 1000 },
  "leche-avena":       { unidadCompra: "botella", factorConversion: 1000 },
  "leche-sin-lactosa": { unidadCompra: "botella", factorConversion: 1000 },
  "leche-de-soja":     { unidadCompra: "botella", factorConversion: 1000, unidad: "ml", escalarPor: 1000 },
  "crema":             { unidadCompra: "pote",    factorConversion: 1000 },
  "salmon":            { unidadCompra: "envase",  factorConversion: 1000 }
};

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

const ENVASES_KEY = "envases_normalizados_v11";

// ---------------------------------------------------------------------------
// Limpieza del catalogo (v12)
// ---------------------------------------------------------------------------
// Insumos que entraron por la lectura de facturas con el titulo literal del
// proveedor como nombre y su CODIGO como unidad: "METRO Chef Sirope de caramelo
// en botella 1 Kg", unidad "BT". Inusables para escribir una receta.
//
// Por que esto va en el codigo y no se arregla en la nube: se intento editar
// Supabase directamente y duro unas horas. La app sube su catalogo local
// ENTERO en cada arranque (`subidaDeArranque`), asi que la copia del
// dispositivo gana siempre y revirtio todo. Peor: revirtio los insumos pero no
// los movimientos del ledger, que no viajan en ese snapshot, y quedaron
// unidades viejas con cantidades nuevas. La correccion tiene que correr EN el
// dispositivo para que despues suba sola.
//
// `escalarLedger: true` es un permiso explicito: estos insumos SI tienen
// movimientos, y aun asi se les cambia la unidad base. Se puede porque son una
// unica carga por factura (una compra), no historia real del negocio. Para
// cualquier otro insumo la regla sigue siendo la contraria.
// Cada entrada DECLARA el destino en vez de calcularlo. Es la leccion de la
// primera version: escalaba las recetas por un factor, y en una base donde ya
// estaban bien las multiplico igual (25 g -> 25000 g). Una migracion no puede
// suponer de donde parte; tiene que decir adonde llega. Asi ademas correrla dos
// veces no hace daño.
//
// `recetaObjetivo`: cuanto lleva UNA unidad del producto, en la unidad nueva.
// `ledgerPor`: cuanto multiplicar los movimientos ya cargados. null = ya estan
//   en la unidad nueva y no se tocan. Las pajitas son ese caso: la factura
//   decia 250 y son 250 pajitas (una bolsa), no 250 bolsas.
const LIMPIEZA_CATALOGO_V12 = {
  "mortadela-italiana-c-kg": {
    nombre: "Mortadela", unidad: "g", unidadCompra: "kg", factorConversion: 1000,
    stockMinimo: 400, stockCritico: 200, recetaObjetivo: 25, ledgerPor: 1000
  },
  "metro-chef-sirope-de-caramelo-en-botella-1-kg": {
    nombre: "Sirope de caramelo", unidad: "g", unidadCompra: "botella", factorConversion: 1000,
    stockMinimo: 500, stockCritico: 250, recetaObjetivo: 20, ledgerPor: 1000
  },
  "metro-professional-pajitas-de-papel-bio-14-5-cm-x-6-mm-250unidades": {
    nombre: "Pajitas", unidad: "unidad", unidadCompra: "bolsa", factorConversion: 250,
    stockMinimo: 250, stockCritico: 125, recetaObjetivo: 1, ledgerPor: null
  }
};

// Consumibles que entraron por factura y que el dueño decidio que NO forman
// parte del ecosistema ("solo guarda pajitas y sirope"). No se borran: tienen
// una compra en el ledger y el borrado necesita permisos que produccion no
// tiene. Desactivarlos los saca de la lista y es reversible.
const INSUMOS_FUERA_V12 = [
  "metro-chef-harina-de-trigo-de-uso-comun-5-kg",
  "metro-chef-mantequilla-pura-1-kg",
  "metro-professional-cuchara-de-madera-bio-16-5cm-100-unidades",
  "metro-professional-papel-higienico-de-2-capas-48-metros-contiene-12-rollos",
  "grillix-ensaladera-plastico-1000cc-50-unidades"
];

// Lineas de proveedor que quedaron apuntando al texto "null" porque la lectura
// de facturas nunca las vinculo a un insumo. Las que no tienen con que
// vincularse (alfajores, granola, chocolinas) se dejan: son compras reales.
const PROVEEDOR_INSUMOS_V12 = {
  "jasa:salmon": "salmon",
  "jasa:queso-mezcla": "mezcla",
  "makro:pajitas": "metro-professional-pajitas-de-papel-bio-14-5-cm-x-6-mm-250unidades",
  "makro:sirope-caramelo": "metro-chef-sirope-de-caramelo-en-botella-1-kg"
};
const PROVEEDOR_INSUMOS_FUERA_V12 = ["makro:mantequilla"];

// Cuando cambia la unidad base de un insumo, lo que el proveedor vende hay que
// reexpresarlo igual. Es el olvido que ya costo caro dos veces: la leche de
// soja paso de L a ml y su linea quedo diciendo que un litro del proveedor era
// 1 ml -> la app pidio 3862 litros. Despues lo mismo con la mortadela: "pedir
// 514 K". Si manaña se cambia la unidad de otro insumo, esta tabla tambien.
const PROVEEDOR_UNIDADES_V12 = {
  "jasa:mortadela-italiana-c-kg": { unidadCompra: "kg", cantidadPorUnidad: 1000 },
  "makro:metro-chef-sirope-de-caramelo-en-botella-1-kg": { unidadCompra: "botella", cantidadPorUnidad: 1000 },
  // Las pajitas ya traian 250 por bolsa: solo se arregla el nombre "B".
  "makro:metro-professional-pajitas-de-papel-bio-14-5-cm-x-6-mm-250unidades": { unidadCompra: "bolsa", cantidadPorUnidad: 250 }
};

const LIMPIEZA_KEY = "limpieza_catalogo_v12";

// ---------------------------------------------------------------------------
// Limpieza v13 — lo que encontro la auditoria de unidades
// ---------------------------------------------------------------------------
// Tres cosas que estaban rotas en datos, no en codigo, y que el dueño confirmo
// uno por uno. Mismo criterio que la v12: se DECLARA el destino, nunca se
// calcula desde un punto de partida que no se puede conocer.
//
// 1. `salami-tio-d-oro-c-kg` era el segundo caso "mortadela": entro por
//    factura con el titulo del proveedor como nombre y su codigo "K" como
//    unidad base. Se descontaba 0,45 "K" por Salame y, con minimos en 0, nunca
//    iba a pedir reposicion: fallaba en silencio. Tiene 0 movimientos, asi que
//    cambiarle la unidad es seguro.
// 2. `salame:queso-gouda` decia 0,35 g de queso cuando los otros ocho
//    sandwiches llevan 25. Este es peor que el del salami justamente porque NO
//    salta a la vista: no da un numero absurdo, da un consumo 70 veces mas
//    chico, y el gouda nunca parece bajar.
// 3. La linea de proveedor de la leche de soja seguia diciendo que un litro
//    son 1 ml — el bug original, que se arreglo en el insumo y se olvido en el
//    proveedor. Hoy la lista pide 3000 L.
const LIMPIEZA_V13 = {
  insumos: {
    "salami-tio-d-oro-c-kg": {
      nombre: "Salami", unidad: "g", unidadCompra: "kg", factorConversion: 1000,
      stockMinimo: 500, stockCritico: 250,
      // Sin movimientos: no hay ledger que reexpresar.
      ledgerPor: null
    }
  },
  // Cantidades de receta, por id de receta. El dueño las dio una por una.
  recetas: {
    "salame:salami-tio-d-oro-c-kg": 40,
    "salame:queso-gouda": 25
  },
  // El dueño: "los de crema con cinnamon roll no lo se, pero no es algo que
  // mediria de momento la crema... borralo".
  recetasABorrar: ["cinnamon-roll:crema"],
  proveedores: {
    "jasa:salami-tio-d-oro-c-kg": { unidadCompra: "kg", cantidadPorUnidad: 1000 },
    // SUPUESTO, a confirmar: la linea dice "L" a 1,50 EUR, que es precio de
    // litro suelto, asi que 1 unidad de compra = 1000 ml. Si Delicias lo
    // vendiera por caja, este numero cambia.
    "delicias-vegetales:leche-de-soja": { unidadCompra: "L", cantidadPorUnidad: 1000 }
  }
};

const LIMPIEZA_V13_KEY = "limpieza_catalogo_v13";

// ---------------------------------------------------------------------------
// v14 — una sola leche por cafe, y los productos de reventa
// ---------------------------------------------------------------------------
// A) El cafe con leche descontaba las TRES leches a la vez (entera 210 +
//    avena 200 + soja 250), y el capuccino dos. La receta tiene que tener UNA
//    sola —la de por defecto— y el grupo de variante la cambia por la que
//    elige el cliente al cobrar. Las lineas de mas se cargaron como receta
//    porque la soja no era una opcion del grupo; se agrega como opcion.
const LECHES_DE_MAS_V14 = [
  "cafe-con-leche:leche-avena",
  "cafe-con-leche:leche-de-soja",
  "capuccino:leche-sin-lactosa"
];
const OPCION_SOJA_V14 = { nombre: "Soja", insumoId: "leche-de-soja" };

// B) Bebidas y bolleria: se compran hechas y se venden por unidad. El dueño:
//    "cada coca vendida, descuenta directamente 1 insumo de coca cola".
//    Tecnicamente es una receta de 1 unidad — la misma maquinaria de siempre,
//    sin inventar un camino nuevo — y asi entran en la lista de compras con su
//    proveedor y su precio, que es lo que se gana.
//
//    El insumo lleva el MISMO id que el producto: no hay ambiguedad posible y
//    en la lista de compras se lee solo ("Coca cola, pedir 12").
//
//    El minimo es un arranque razonable, no un dato: el dueño lo ajusta. Pero
//    no puede ser 0: un insumo con minimo 0 nunca pide reposicion y falla en
//    silencio (es lo que pasaba con el salami).
const REVENTA_V14 = [
  { id: "coca-cola",        nombre: "Coca cola",        minimo: 12 },
  { id: "sprite",           nombre: "Sprite",           minimo: 12 },
  { id: "agua",             nombre: "Agua",             minimo: 12 },
  { id: "aquiaros",         nombre: "Aquarius",         minimo: 12 },
  { id: "nestea",           nombre: "Nestea",           minimo: 12 },
  { id: "jugo",             nombre: "Zumo",             minimo: 12 },
  { id: "cerveza",          nombre: "Cerveza",          minimo: 12 },
  { id: "medialunas",       nombre: "Medialunas",       minimo: 10 },
  { id: "croissant",        nombre: "Croissant",        minimo: 10 },
  { id: "mini-croissant",   nombre: "Mini croissant",   minimo: 10 },
  { id: "pain-au-chocolat", nombre: "Pain au chocolat", minimo: 10 },
  { id: "cinnamon-roll",    nombre: "Cinnamon roll",    minimo: 10 },
  { id: "cookies",          nombre: "Cookies",          minimo: 10 },
  { id: "chipa",            nombre: "Chipa",            minimo: 10 },
  { id: "alfajor-havana",   nombre: "Alfajor Havana",   minimo: 10 },
  { id: "galletitas",       nombre: "Galletitas",       minimo: 10 }
];

const LIMPIEZA_V14_KEY = "limpieza_catalogo_v14";

// ---------------------------------------------------------------------------
// Set completo para probar — SOLO contra la base de prueba
// ---------------------------------------------------------------------------
// Staging tiene los mismos productos que produccion, pero 33 quedaron ocultos
// cuando se armo el dataset simulado: la caja mostraba 8 y no se podia probar
// el menu de verdad.
//
// Por que es una migracion de codigo y no un UPDATE a la nube: en cada
// arranque `subidaDeArranque` (app.js) sube el catalogo LOCAL entero, asi que
// lo que se corrija en Supabase lo vuelve a pisar el dispositivo en el
// siguiente boot. Ya paso: el 07/10 los active en la nube y volvieron a
// ocultarse solos.
//
// Y por que solo en la base de prueba: en produccion `activo` es una decision
// real del dueño — lo que no se vende hoy esta oculto a proposito (ahi mismo
// hay 5 ocultos). Despertar productos en la tablet del local seria cambiarle
// el menu sin que lo haya pedido.
const CATALOGO_COMPLETO_PRUEBA = [
  // Sandwiches
  "jamon-queso", "pasta-oliva-queso", "pimiento-gouda-philp", "pesto-tomate-queso",
  "berenjena-brie", "mortadela-pesto-queso", "jamon-serrano-rucula", "atun-palta-queso",
  "huevo-jamon", "huevo-queso", "salame", "especial-semanal",
  "promo-bebida", "promo-cafe-con-leche",
  // Bolleria
  "croissant", "mini-croissant", "mini-croissant-ddl", "pain-au-chocolat",
  "chipa", "alfajor-havana", "cookies", "medialunas", "cinnamon-roll", "galletitas",
  // Cafe
  "expresso-30ml", "cortado", "latte", "cafe-con-leche", "capuccino",
  "americano", "flat-white", "ice-latte", "ice-caramel",
  // Bebidas
  "cerveza", "coca-cola", "sprite", "nestea", "aquiaros", "jugo", "agua", "fanta"
];

// Tres cosas que saltan al ponerlos visibles, porque hasta ahora nadie los veia:
//
// 1) "fanta" y "galletitas" estan escritos en minuscula. En la caja el nombre
//    se lee tal cual, al lado de "Coca cola" y "Cookies".
const NOMBRES_A_CORREGIR_PRUEBA = { fanta: "Fanta", galletitas: "Galletitas" };

// 2) Fanta no tenia receta: es una bebida de reventa como las demas, descuenta
//    1 por venta (mismo criterio que REVENTA_V14).
const REVENTA_PRUEBA = [{ id: "fanta", nombre: "Fanta", minimo: 12 }];

// 3) "Especial semanal" y "Promo bebida" no descontaban NADA. Un producto
//    activo sin receta es una fuga silenciosa de stock, asi que:
//    - al especial se le pone el pan, que lo lleva sea cual sea el relleno de
//      la semana (0.5 rebanada, igual que todos los sandwiches). El relleno lo
//      carga el dueño cada semana desde Gestion > Menu.
//    - la promo de bebida descuenta una bebida, y cual la elige el cliente en
//      caja: es exactamente el mecanismo del grupo de variante que ya usa la
//      leche, no hace falta nada nuevo.
const RECETAS_FALTANTES_PRUEBA = [
  { id: "especial-semanal:miga", productoId: "especial-semanal", insumoId: "miga", cantidad: 0.5 },
  { id: "promo-bebida:coca-cola", productoId: "promo-bebida", insumoId: "coca-cola", cantidad: 1 }
];
const GRUPO_BEBIDA_PRUEBA = {
  id: "bebida",
  nombre: "Bebida",
  titulo: "¿Qué bebida?",
  opciones: [
    { nombre: "Coca cola", insumoId: "coca-cola" },
    { nombre: "Sprite", insumoId: "sprite" },
    { nombre: "Fanta", insumoId: "fanta" },
    { nombre: "Nestea", insumoId: "nestea" },
    { nombre: "Aquarius", insumoId: "aquiaros" },
    { nombre: "Zumo", insumoId: "jugo" },
    { nombre: "Agua", insumoId: "agua" }
  ],
  productoIds: ["promo-bebida"]
};

const SET_PRUEBA_KEY = "set_completo_prueba_v1";

// Corre DESPUES de bajar el catalogo de la nube, no dentro del seed.
//
// Primero lo intente en seedInsumos y la prueba lo encontro: en un dispositivo
// recien instalado el seed corre cuando lo unico que hay en la base son los
// insumos del seed. Crema, salmon y leche de soja no estan ahi — los creo el
// usuario desde la app — y llegan recien con pullInsumosDesdeNube, o sea
// despues. La correccion no los veia nunca, y como la version de seed ya
// quedaba marcada, tampoco volvia a intentarlo.
//
// Al final sube el resultado: asi la nube queda corregida sin tocarla a mano, y
// los demas dispositivos se lo bajan ya bien. Cuando ya esta todo en orden no
// escribe nada y no sube nada.
export async function normalizarEnvasesInsumos() {
  const [insumos, recetas, movimientos, config] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("movimientos_insumos"),
    getAll("configuracion")
  ]);
  if (config.find(c => c.id === ENVASES_KEY)?.valor) return { corregidos: [] };

  const conMovimientos = new Set(movimientos.map(m => m.insumoId));
  const now = new Date().toISOString();
  const insumosArreglados = [];
  const recetasArregladas = [];

  for (const [id, fix] of Object.entries(ENVASES_NORMALIZADOS_V11)) {
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) continue;
    const escala = fix.escalarPor || 1;

    // Cambiar la unidad base de un insumo que YA tiene movimientos cargados
    // dejaria el historial escrito en la unidad vieja y el stock en la nueva:
    // el ledger es la verdad del stock, asi que mejor no tocar nada y que
    // quede a la vista, antes que reescribir numeros a ciegas.
    if (escala !== 1 && conMovimientos.has(id)) continue;

    const escalar = (v) => (Number.isFinite(Number(v)) ? Number(v) * escala : v);
    const yaEstaba = insumo.unidadCompra === fix.unidadCompra
      && insumo.factorConversion === fix.factorConversion
      && (!fix.unidad || insumo.unidad === fix.unidad);
    if (yaEstaba) continue;

    insumosArreglados.push({
      ...insumo,
      unidad: fix.unidad || insumo.unidad,
      unidadCompra: fix.unidadCompra,
      factorConversion: fix.factorConversion,
      stockActual: escalar(insumo.stockActual),
      stockMinimo: escalar(insumo.stockMinimo),
      stockCritico: escalar(insumo.stockCritico),
      actualizadoEn: now
    });
    if (escala === 1) continue;
    // OJO: cambiar la unidad base arrastra TODO lo que este expresado en esa
    // unidad, no solo el stock. Se me escapo proveedor_insumos la primera vez:
    // la leche de soja paso de L a ml pero su cantidadPorUnidad quedo en 1, asi
    // que la app creyo que un litro del proveedor eran 1 ml y llego a pedir
    // 3862 L. El que agregue una migracion de unidades aca tiene que revisar
    // tambien proveedor_insumos (se corrige en la nube, es de donde se baja).
    //
    // Las recetas que lo consumen estaban escritas en la unidad vieja (0,25 L)
    // y hay que reexpresarlas (250 ml).
    for (const receta of recetas) {
      if (receta.insumoId !== id) continue;
      recetasArregladas.push({ ...receta, cantidadPorUnidad: escalar(receta.cantidadPorUnidad), actualizadoEn: now });
    }
  }

  await withStores(["insumos", "recetas", "configuracion"], "readwrite", (stores) => {
    for (const i of insumosArreglados) stores.insumos.put(i);
    for (const r of recetasArregladas) stores.recetas.put(r);
    stores.configuracion.put({ id: ENVASES_KEY, valor: true, actualizadoEn: now });
  });

  if (insumosArreglados.length === 0) return { corregidos: [] };

  const [insumosFinal, recetasFinal] = await Promise.all([getAll("insumos"), getAll("recetas")]);
  trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  if (recetasArregladas.length > 0) trySyncRecetasSnapshot(recetasFinal).catch(() => {});

  return { corregidos: insumosArreglados.map(i => ({ id: i.id, nombre: i.nombre, envase: i.unidadCompra })) };
}

// El estado de cada insumo, con las dos lecturas:
//
//  - `estadoStock` (critico/bajo/ok) es el viejo umbral fijo. Se mantiene
//    porque hay pantallas que todavia lo leen, pero NO es el que manda.
//  - `prediccion` responde lo que de verdad importa: si el stock llega hasta
//    que entre el proximo pedido. Un umbral fijo no sabe nada del tiempo: el
//    cafe decia "bajo" con 790 g aunque eso fueran 5 dias y el pedido entrara
//    en 3, y al reves un insumo podia decir "ok" y no llegar porque el
//    proveedor tarda 5 dias.
//
// `pedidos` es opcional a proposito: los encargos de clientes viven SOLO en la
// nube (no hay store local), asi que sin internet llega vacio. El estado tiene
// que servir igual — por eso viaja `pedidosIncluidos`, para poder decir en
// pantalla que la cuenta no los contempla en vez de quedarse corta en silencio.
// Corre despues de bajar el catalogo, igual que normalizarEnvasesInsumos y por
// el mismo motivo: estos insumos no vienen del seed, los creo la lectura de
// facturas, asi que en un dispositivo recien instalado no existen todavia
// cuando corre el seed.
export async function limpiarCatalogoV12() {
  const [insumos, recetas, movimientos, proveedorInsumos, config] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("movimientos_insumos"),
    getAll("proveedor_insumos"),
    getAll("configuracion")
  ]);
  if (config.find(c => c.id === LIMPIEZA_KEY)?.valor) return { cambios: 0 };

  const now = new Date().toISOString();
  const insumosNuevos = [];
  const recetasNuevas = [];
  const movimientosNuevos = [];
  const piNuevos = [];

  for (const [id, fix] of Object.entries(LIMPIEZA_CATALOGO_V12)) {
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) continue;
    const cambiaLaUnidad = insumo.unidad !== fix.unidad || insumo.factorConversion !== fix.factorConversion;

    if (cambiaLaUnidad || insumo.nombre !== fix.nombre) {
      insumosNuevos.push({
        ...insumo,
        nombre: fix.nombre,
        unidad: fix.unidad,
        unidadCompra: fix.unidadCompra,
        factorConversion: fix.factorConversion,
        // El stock se recalcula solo desde el ledger (trigger de la migracion
        // 012), asi que no hace falta tocarlo aca: moviendo los movimientos
        // alcanza. Tocarlo ademas lo dejaria descuadrado contra su propia suma.
        stockMinimo: fix.stockMinimo,
        stockCritico: fix.stockCritico,
        actualizadoEn: now
      });
    }

    // La receta se LLEVA al valor correcto, venga de donde venga.
    for (const r of recetas) {
      if (r.insumoId !== id) continue;
      if (Number(r.cantidadPorUnidad) === fix.recetaObjetivo) continue;
      recetasNuevas.push({ ...r, cantidadPorUnidad: fix.recetaObjetivo, actualizadoEn: now });
    }

    // El ledger SI se escala, porque es historia y no tiene un valor objetivo
    // que declarar. Solo cuando la unidad cambia de verdad en esta corrida: si
    // ya estaba bien, multiplicar seria romperlo.
    if (cambiaLaUnidad && fix.ledgerPor) {
      for (const m of movimientos) {
        if (m.insumoId !== id) continue;
        movimientosNuevos.push({ ...m, cantidad: Number(m.cantidad) * fix.ledgerPor });
      }
    }
  }

  for (const id of INSUMOS_FUERA_V12) {
    const insumo = insumos.find(i => i.id === id);
    if (insumo && insumo.activo !== false) insumosNuevos.push({ ...insumo, activo: false, actualizadoEn: now });
  }

  for (const [id, insumoId] of Object.entries(PROVEEDOR_INSUMOS_V12)) {
    const pi = proveedorInsumos.find(x => x.id === id);
    if (pi && pi.insumoId !== insumoId) piNuevos.push({ ...pi, insumoId, actualizadoEn: now });
  }
  for (const id of PROVEEDOR_INSUMOS_FUERA_V12) {
    const pi = proveedorInsumos.find(x => x.id === id);
    if (pi && pi.activo !== false) piNuevos.push({ ...pi, activo: false, actualizadoEn: now });
  }

  for (const [id, fix] of Object.entries(PROVEEDOR_UNIDADES_V12)) {
    const pi = proveedorInsumos.find(x => x.id === id);
    if (!pi) continue;
    if (pi.unidadCompra === fix.unidadCompra && pi.cantidadPorUnidad === fix.cantidadPorUnidad) continue;
    piNuevos.push({ ...pi, unidadCompra: fix.unidadCompra, cantidadPorUnidad: fix.cantidadPorUnidad, actualizadoEn: now });
  }

  const cambios = insumosNuevos.length + recetasNuevas.length + movimientosNuevos.length + piNuevos.length;

  await withStores(["insumos", "recetas", "movimientos_insumos", "proveedor_insumos", "configuracion"], "readwrite", (stores) => {
    for (const i of insumosNuevos) stores.insumos.put(i);
    for (const r of recetasNuevas) stores.recetas.put(r);
    for (const m of movimientosNuevos) stores.movimientos_insumos.put(m);
    for (const x of piNuevos) stores.proveedor_insumos.put(x);
    stores.configuracion.put({ id: LIMPIEZA_KEY, valor: true, actualizadoEn: now });
  });

  if (cambios === 0) return { cambios: 0 };

  const [insFinal, recFinal, piFinal] = await Promise.all([getAll("insumos"), getAll("recetas"), getAll("proveedor_insumos")]);
  trySyncInsumosSnapshot(insFinal).catch(() => {});
  if (recetasNuevas.length) trySyncRecetasSnapshot(recFinal).catch(() => {});
  if (piNuevos.length) trySyncProveedorInsumosSnapshot(piFinal).catch(() => {});
  if (movimientosNuevos.length) trySyncMovimientosInsumos(movimientosNuevos).catch(() => {});

  return { cambios, insumos: insumosNuevos.map(i => i.nombre) };
}

// Sacar un insumo de circulacion.
//
// No se borra: tiene movimientos en el ledger y el stock se deriva de ahi, asi
// que borrarlo dejaria huerfana su historia. Ademas el borrado remoto necesita
// una politica de RLS que produccion no tiene. Desactivarlo lo saca de todas
// las listas, de la lista de compras y del aviso de pendientes, y se puede
// volver atras.
export async function descartarInsumo(insumoId) {
  const insumo = await getOne("insumos", insumoId);
  if (!insumo) throw new Error("Ese insumo no existe en este dispositivo.");

  const recetas = await getAll("recetas");
  const enUso = recetas.filter((r) => r.insumoId === insumoId);
  if (enUso.length > 0) {
    const productos = await getAll("productos");
    const nombres = enUso
      .map((r) => productos.find((p) => p.id === r.productoId)?.nombre || r.productoId)
      .slice(0, 3);
    throw new Error(`No se puede: lo usa ${nombres.join(", ")}${enUso.length > 3 ? ` y ${enUso.length - 3} más` : ""}. Sacalo de esas recetas primero.`);
  }

  await withStores(["insumos"], "readwrite", (stores) => {
    stores.insumos.put({ ...insumo, activo: false, actualizadoEn: new Date().toISOString() });
  });

  // Sus lineas de proveedor tambien salen: si el insumo no se usa, no tiene
  // sentido que siga apareciendo en la lista de compras.
  const proveedorInsumos = await getAll("proveedor_insumos");
  const suyas = proveedorInsumos.filter((pi) => pi.insumoId === insumoId && pi.activo !== false);
  if (suyas.length > 0) {
    const now = new Date().toISOString();
    await withStores(["proveedor_insumos"], "readwrite", (stores) => {
      for (const pi of suyas) stores.proveedor_insumos.put({ ...pi, activo: false, actualizadoEn: now });
    });
  }

  const [insumosFinal, piFinal] = await Promise.all([getAll("insumos"), getAll("proveedor_insumos")]);
  trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  if (suyas.length > 0) trySyncProveedorInsumosSnapshot(piFinal).catch(() => {});

  return { nombre: insumo.nombre, lineasProveedor: suyas.length };
}

// Sacar un insumo de la receta de un producto.
//
// Esto SI borra la fila: una linea de receta no es historia, es configuracion
// — dice cuanto lleva un producto hoy. Lo que queda registrado es el consumo
// que ya ocurrio (movimientos_insumos), y eso no se toca.
//
// El snapshot de recetas es un upsert y no borra lo que falta, asi que la fila
// hay que sacarla tambien de la nube. Si no, vuelve en el proximo
// "Actualizar catalogo".
export async function eliminarLineaReceta(recetaId) {
  const receta = await getOne("recetas", recetaId);
  if (!receta) return { borrada: false };

  await withStores(["recetas"], "readwrite", (stores) => {
    stores.recetas.delete(recetaId);
  });

  await deleteRecetaRemota(recetaId).catch(() => {});
  const recetasFinal = await getAll("recetas");
  trySyncRecetasSnapshot(recetasFinal).catch(() => {});

  return { borrada: true, productoId: receta.productoId, insumoId: receta.insumoId };
}

// Corre despues de bajar el catalogo, por el mismo motivo que las anteriores:
// estos insumos no vienen del seed y en un dispositivo nuevo recien existen
// despues del pull.
export async function limpiarCatalogoV13() {
  const [insumos, recetas, movimientos, proveedorInsumos, config] = await Promise.all([
    getAll("insumos"), getAll("recetas"), getAll("movimientos_insumos"),
    getAll("proveedor_insumos"), getAll("configuracion")
  ]);
  if (config.find(c => c.id === LIMPIEZA_V13_KEY)?.valor) return { cambios: 0 };

  const now = new Date().toISOString();
  const insumosNuevos = [];
  const recetasNuevas = [];
  const recetasBorradas = [];
  const movimientosNuevos = [];
  const piNuevos = [];

  for (const [id, fix] of Object.entries(LIMPIEZA_V13.insumos)) {
    const insumo = insumos.find(i => i.id === id);
    if (!insumo) continue;
    const yaEstaba = insumo.unidad === fix.unidad && insumo.factorConversion === fix.factorConversion && insumo.nombre === fix.nombre;
    if (yaEstaba) continue;

    const conMovimientos = movimientos.filter(m => m.insumoId === id);
    // La regla que la auditoria pidio promover de caso particular a invariante:
    // cambiar la unidad base con el ledger escrito en la vieja corrompe el
    // stock. Si hay movimientos y nadie declaro como reexpresarlos, no se toca.
    if (conMovimientos.length > 0 && !fix.ledgerPor) continue;

    insumosNuevos.push({
      ...insumo, nombre: fix.nombre, unidad: fix.unidad,
      unidadCompra: fix.unidadCompra, factorConversion: fix.factorConversion,
      stockMinimo: fix.stockMinimo, stockCritico: fix.stockCritico,
      actualizadoEn: now
    });
    if (fix.ledgerPor) {
      for (const m of conMovimientos) movimientosNuevos.push({ ...m, cantidad: Number(m.cantidad) * fix.ledgerPor });
    }
  }

  for (const [recetaId, objetivo] of Object.entries(LIMPIEZA_V13.recetas)) {
    const receta = recetas.find(r => r.id === recetaId);
    if (!receta || Number(receta.cantidadPorUnidad) === objetivo) continue;
    recetasNuevas.push({ ...receta, cantidadPorUnidad: objetivo, esEstimado: false, actualizadoEn: now });
  }

  for (const recetaId of LIMPIEZA_V13.recetasABorrar) {
    if (recetas.some(r => r.id === recetaId)) recetasBorradas.push(recetaId);
  }

  for (const [id, fix] of Object.entries(LIMPIEZA_V13.proveedores)) {
    const pi = proveedorInsumos.find(x => x.id === id);
    if (!pi) continue;
    if (pi.unidadCompra === fix.unidadCompra && pi.cantidadPorUnidad === fix.cantidadPorUnidad) continue;
    piNuevos.push({ ...pi, unidadCompra: fix.unidadCompra, cantidadPorUnidad: fix.cantidadPorUnidad, actualizadoEn: now });
  }

  const cambios = insumosNuevos.length + recetasNuevas.length + recetasBorradas.length + movimientosNuevos.length + piNuevos.length;

  await withStores(["insumos", "recetas", "movimientos_insumos", "proveedor_insumos", "configuracion"], "readwrite", (stores) => {
    for (const i of insumosNuevos) stores.insumos.put(i);
    for (const r of recetasNuevas) stores.recetas.put(r);
    for (const id of recetasBorradas) stores.recetas.delete(id);
    for (const m of movimientosNuevos) stores.movimientos_insumos.put(m);
    for (const x of piNuevos) stores.proveedor_insumos.put(x);
    stores.configuracion.put({ id: LIMPIEZA_V13_KEY, valor: true, actualizadoEn: now });
  });

  if (cambios === 0) return { cambios: 0 };

  // Una receta borrada hay que sacarla tambien de la nube: el snapshot es un
  // upsert y no borra lo que falta, asi que volveria en el proximo refresco.
  for (const id of recetasBorradas) await deleteRecetaRemota(id).catch(() => {});

  const [insFinal, recFinal, piFinal] = await Promise.all([getAll("insumos"), getAll("recetas"), getAll("proveedor_insumos")]);
  trySyncInsumosSnapshot(insFinal).catch(() => {});
  trySyncRecetasSnapshot(recFinal).catch(() => {});
  trySyncProveedorInsumosSnapshot(piFinal).catch(() => {});
  if (movimientosNuevos.length) trySyncMovimientosInsumos(movimientosNuevos).catch(() => {});

  return { cambios, insumos: insumosNuevos.map(i => i.nombre), recetas: recetasNuevas.length, borradas: recetasBorradas };
}

export async function limpiarCatalogoV14() {
  const [insumos, recetas, productos, config] = await Promise.all([
    getAll("insumos"), getAll("recetas"), getAll("productos"), getAll("configuracion")
  ]);
  if (config.find(c => c.id === LIMPIEZA_V14_KEY)?.valor) return { cambios: 0 };

  const now = new Date().toISOString();
  const recetasBorradas = LECHES_DE_MAS_V14.filter(id => recetas.some(r => r.id === id));

  // Los insumos de reventa y su receta 1:1, solo para los productos que
  // existen en este dispositivo.
  const insumosNuevos = [];
  const recetasNuevas = [];
  for (const art of REVENTA_V14) {
    const producto = productos.find(p => p.id === art.id);
    if (!producto) continue;
    if (!insumos.some(i => i.id === art.id)) {
      insumosNuevos.push({
        id: art.id, nombre: art.nombre, unidad: "unidad",
        // Sin envase: cuantos trae la caja lo sabe el dueño, y el campo ya se
        // puede completar desde la pantalla de insumos.
        unidadCompra: "unidad", factorConversion: 1,
        stockActual: 0, stockMinimo: art.minimo, stockCritico: Math.round(art.minimo / 2),
        esEstimado: false, activo: true, creadoEn: now, actualizadoEn: now
      });
    }
    const recetaId = `${art.id}:${art.id}`;
    if (!recetas.some(r => r.id === recetaId)) {
      recetasNuevas.push({
        id: recetaId, productoId: art.id, insumoId: art.id,
        cantidadPorUnidad: 1, esEstimado: false, creadoEn: now, actualizadoEn: now
      });
    }
  }

  // La soja tiene que ser una OPCION del grupo, no una receta aparte: es
  // justamente por no estar en el grupo que alguien la cargo como linea suelta
  // y el cafe termino descontando tres leches.
  let grupoActualizado = null;
  const grupos = await getGruposVariantes().catch(() => []);
  const grupoLeche = grupos.find((g) => g.opciones?.some((o) => o.insumoId === "leche-normal"));
  if (grupoLeche && !grupoLeche.opciones.some((o) => o.insumoId === OPCION_SOJA_V14.insumoId)
      && insumos.some((i) => i.id === OPCION_SOJA_V14.insumoId)) {
    grupoActualizado = { ...grupoLeche, opciones: [...grupoLeche.opciones, { ...OPCION_SOJA_V14 }] };
  }

  const cambios = recetasBorradas.length + insumosNuevos.length + recetasNuevas.length + (grupoActualizado ? 1 : 0);

  await withStores(["insumos", "recetas", "configuracion"], "readwrite", (stores) => {
    for (const id of recetasBorradas) stores.recetas.delete(id);
    for (const i of insumosNuevos) stores.insumos.put(i);
    for (const r of recetasNuevas) stores.recetas.put(r);
    stores.configuracion.put({ id: LIMPIEZA_V14_KEY, valor: true, actualizadoEn: now });
  });

  if (cambios === 0) return { cambios: 0 };

  // El snapshot de recetas es un upsert y no borra lo que falta: las leches de
  // mas hay que sacarlas tambien de la nube o vuelven en el proximo refresco.
  for (const id of recetasBorradas) await deleteRecetaRemota(id).catch(() => {});

  // saveGrupoVariante hace su propia escritura y su propio sync, asi que va
  // despues de la transaccion de arriba y no adentro.
  if (grupoActualizado) await saveGrupoVariante(grupoActualizado).catch(() => {});

  const [insFinal, recFinal] = await Promise.all([getAll("insumos"), getAll("recetas")]);
  trySyncInsumosSnapshot(insFinal).catch(() => {});
  trySyncRecetasSnapshot(recFinal).catch(() => {});

  return { cambios, borradas: recetasBorradas, reventa: insumosNuevos.map(i => i.nombre), soja: Boolean(grupoActualizado) };
}

export async function activarSetCompletoDePrueba() {
  if (!ENTORNO_DE_PRUEBA) return { cambios: 0, motivo: "no es la base de prueba" };

  const [productos, insumos, recetas, config] = await Promise.all([
    getAll("productos"), getAll("insumos"), getAll("recetas"), getAll("configuracion")
  ]);
  if (config.find((c) => c.id === SET_PRUEBA_KEY)?.valor) return { cambios: 0 };

  const now = new Date().toISOString();

  // Se declara el destino (visible) en vez de calcularlo: asi correrla dos
  // veces da el mismo resultado y no depende de como estaba antes.
  const aMostrar = productos.filter((p) => CATALOGO_COMPLETO_PRUEBA.includes(p.id) && p.activo === false);
  const aRenombrar = productos.filter((p) => NOMBRES_A_CORREGIR_PRUEBA[p.id] && p.nombre !== NOMBRES_A_CORREGIR_PRUEBA[p.id]);

  const insumosNuevos = [];
  const recetasNuevas = [];
  for (const art of REVENTA_PRUEBA) {
    if (!productos.some((p) => p.id === art.id)) continue;
    if (!insumos.some((i) => i.id === art.id)) {
      insumosNuevos.push({
        id: art.id, nombre: art.nombre, unidad: "unidad",
        unidadCompra: "unidad", factorConversion: 1,
        stockActual: 0, stockMinimo: art.minimo, stockCritico: Math.round(art.minimo / 2),
        esEstimado: false, activo: true, creadoEn: now, actualizadoEn: now
      });
    }
    const recetaId = `${art.id}:${art.id}`;
    if (!recetas.some((r) => r.id === recetaId)) {
      recetasNuevas.push({
        id: recetaId, productoId: art.id, insumoId: art.id,
        cantidadPorUnidad: 1, esEstimado: false, creadoEn: now, actualizadoEn: now
      });
    }
  }
  for (const r of RECETAS_FALTANTES_PRUEBA) {
    if (!productos.some((p) => p.id === r.productoId)) continue;
    if (recetas.some((x) => x.id === r.id)) continue;
    recetasNuevas.push({
      id: r.id, productoId: r.productoId, insumoId: r.insumoId,
      cantidadPorUnidad: r.cantidad, esEstimado: true, creadoEn: now, actualizadoEn: now
    });
  }

  const grupos = await getGruposVariantes().catch(() => []);
  const faltaGrupoBebida = !grupos.some((g) => g.id === GRUPO_BEBIDA_PRUEBA.id);

  const cambios = aMostrar.length + aRenombrar.length + insumosNuevos.length
    + recetasNuevas.length + (faltaGrupoBebida ? 1 : 0);

  await withStores(["productos", "insumos", "recetas", "configuracion"], "readwrite", (stores) => {
    for (const p of aMostrar) stores.productos.put({ ...p, activo: true, actualizadoEn: now });
    for (const p of aRenombrar) {
      const visible = aMostrar.some((x) => x.id === p.id);
      stores.productos.put({ ...p, activo: visible ? true : p.activo, nombre: NOMBRES_A_CORREGIR_PRUEBA[p.id], actualizadoEn: now });
    }
    for (const i of insumosNuevos) stores.insumos.put(i);
    for (const r of recetasNuevas) stores.recetas.put(r);
    stores.configuracion.put({ id: SET_PRUEBA_KEY, valor: true, actualizadoEn: now });
  });

  if (cambios === 0) return { cambios: 0 };

  // saveGrupoVariante escribe y sincroniza por su cuenta: va despues de la
  // transaccion de arriba, nunca adentro.
  if (faltaGrupoBebida) {
    const hayBebidas = GRUPO_BEBIDA_PRUEBA.opciones.filter(
      (o) => insumos.some((i) => i.id === o.insumoId) || insumosNuevos.some((i) => i.id === o.insumoId)
    );
    if (hayBebidas.length >= 2) {
      await saveGrupoVariante({ ...GRUPO_BEBIDA_PRUEBA, opciones: hayBebidas }).catch(() => {});
    }
  }

  const [catFinal, prodFinal, insFinal, recFinal] = await Promise.all([
    getAll("categorias"), getAll("productos"), getAll("insumos"), getAll("recetas")
  ]);
  trySyncCatalogoSnapshot(catFinal, prodFinal).catch(() => {});
  trySyncInsumosSnapshot(insFinal).catch(() => {});
  trySyncRecetasSnapshot(recFinal).catch(() => {});

  return {
    cambios,
    visibles: aMostrar.map((p) => p.nombre),
    renombrados: aRenombrar.map((p) => NOMBRES_A_CORREGIR_PRUEBA[p.id]),
    recetas: recetasNuevas.length
  };
}

export async function listInsumos({ hoy = todayISO(), pedidos = null } = {}) {
  const [insumos, movimientosLocales, proveedorInsumos, proveedores, recetas, serieNube] = await Promise.all([
    getAll("insumos"),
    getAll("movimientos_insumos"),
    getAll("proveedor_insumos"),
    getAll("proveedores"),
    getAll("recetas"),
    leerSerieConsumoLocal().catch(() => ({ serie: [] }))
  ]);

  // El ledger local NO alcanza. La sincronizacion del historial es solo de
  // subida: el dispositivo sube lo que hace, pero nunca baja lo que hicieron
  // los demas. Medido contra staging: 0 movimientos locales contra 587 en la
  // nube. Una tablet de repuesto, el celular o un reemplazo no tenian con que
  // estimar nada — y el modelo viejo tapaba eso cayendo a `stockMinimo / 7` y
  // mostrando esa cuenta inventada como si fuera un dato medido.
  //
  // Asi que se juntan las dos fuentes: lo que bajo de la nube (hasta ayer) y lo
  // que este dispositivo hizo hoy y todavia no subio. Se prefiere lo local
  // cuando hay para la misma fecha: es lo mas nuevo.
  // La primera vez en un dispositivo no hay ninguna copia, y sin ella no hay
  // con que estimar nada: ahi SI se espera la bajada, aunque tarde. Mostrar
  // "sin datos" en la primera pantalla de una tablet recien instalada seria
  // peor que esperar medio segundo. Si no hay internet tampoco se cuelga:
  // sincronizarSerieConsumo devuelve lo que haya (vacio) en vez de tirar.
  //
  // Cuando ya hay copia, el refresco va en segundo plano y la pantalla se
  // dibuja con lo ultimo bajado — que es lo que permite trabajar sin wifi.
  let serie = serieNube?.serie || [];
  if (serie.length === 0) {
    serie = (await sincronizarSerieConsumo({ hasta: hoy }).catch(() => null))?.serie || [];
  } else if (serieNube?.actualizadoEn?.slice(0, 10) !== hoy) {
    sincronizarSerieConsumo({ hasta: hoy }).catch(() => {});
  }

  const vistos = new Set();
  const movimientos = [];
  for (const m of movimientosLocales) {
    movimientos.push(m);
    vistos.add(`${m.insumoId}|${String(m.fecha || "").slice(0, 10)}`);
  }
  for (const punto of serie) {
    if (vistos.has(`${punto.insumoId}|${punto.fecha}`)) continue;
    // La serie viene ya agregada y en positivo; serieDeConsumo espera un
    // movimiento crudo, asi que se le devuelve el signo que tendria en el ledger.
    movimientos.push({ insumoId: punto.insumoId, tipo: "venta", cantidad: -punto.cantidad, fecha: punto.fecha });
  }

  const provById = new Map(proveedores.map(p => [p.id, p]));
  const proveedoresPorInsumo = new Map();
  for (const pi of proveedorInsumos) {
    if (pi.activo === false) continue;
    const prov = provById.get(pi.proveedorId);
    if (!prov || prov.activo === false) continue;
    if (!proveedoresPorInsumo.has(pi.insumoId)) proveedoresPorInsumo.set(pi.insumoId, []);
    proveedoresPorInsumo.get(pi.insumoId).push(prov);
  }

  const activos = insumos.filter(i => i.activo);

  // Hasta donde mirar los pedidos: el horizonte mas largo que cubre cualquier
  // proveedor. Mas alla de eso ya no afecta si llego al proximo pedido.
  let horizonte = 14;
  for (const lista of proveedoresPorInsumo.values()) {
    for (const p of lista) horizonte = Math.max(horizonte, (Number(p.diasCiclo) || 7) + (Number(p.leadTimeDias) || 0));
  }

  const demandaPorInsumo = pedidos
    ? demandaConocidaPorInsumo({ pedidos, recetas, hoy, hastaFecha: sumarDiasISO(hoy, horizonte) })
    : null;

  const estados = estadoDeTodos({
    insumos: activos,
    movimientos,
    proveedoresPorInsumo,
    hoy,
    demandaPorInsumo,
    pedidosIncluidos: Boolean(pedidos)
  });

  const orden = { "no-llega": 0, justo: 1, "sin-proveedor": 2, "sin-datos": 3, bien: 4 };

  return activos
    .map(i => {
      const prediccion = estados.get(i.id);
      return {
        ...i,
        stockEnCompra: i.stockActual / i.factorConversion,
        estadoStock: i.stockActual <= i.stockCritico ? "critico"
                   : i.stockActual <= i.stockMinimo ? "bajo"
                   : "ok",
        prediccion,
        prediccionTexto: explicarEstado(prediccion)
      };
    })
    .sort((a, b) => {
      const pa = orden[a.prediccion?.estado] ?? 9;
      const pb = orden[b.prediccion?.estado] ?? 9;
      return (pa - pb) || a.nombre.localeCompare(b.nombre);
    });
}

// Suma dias a una fecha ISO sin pasar por Date local (reloj simulado).
function sumarDiasISO(fechaISO, dias) {
  const [a, m, d] = String(fechaISO).slice(0, 10).split("-").map(Number);
  const t = Date.UTC(a, m - 1, d) + dias * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// Cuanto pedir de cada insumo, con el modelo que separa "cada cuanto pido" de
// "cuanto tarda en llegar".
//
// El modelo viejo calculaba: consumoDiario x diasCiclo + stockMinimo. Dos
// problemas, los dos medidos sobre los 15 dias de staging:
//
//  1. Ignoraba el lead time. El stock de hoy no tiene que aguantar hasta el
//     proximo PEDIDO, tiene que aguantar hasta que ese pedido LLEGUE. Con Los
//     Reyunos (ciclo 14, tarda ~5) son 19 dias, no 14: al pedido le faltaba un
//     26% y la rotura aparecia cinco dias despues, cuando ya nadie la
//     relacionaba con la lista de compras.
//  2. Su consumoDiario salia del historial de calibraciones, y cuando no habia
//     caia a stockMinimo/7 — una cuenta inventada presentada como dato medido.
//     Ahora sale del consumo real (ledger), con su patron por dia de semana.
//
// A igual capital inmovilizado, en el backtest el modelo viejo rompe stock 27
// dias y este 1.
export async function listaDeComprasSmart({ hoy = todayISO(), pedidos = null } = {}) {
  const [insumos, recetas, proveedorInsumos, proveedores, movimientosLocales, serieNube] = await Promise.all([
    getAll("insumos"),
    getAll("recetas"),
    getAll("proveedor_insumos"),
    getAll("proveedores"),
    getAll("movimientos_insumos"),
    leerSerieConsumoLocal().catch(() => ({ serie: [] }))
  ]);

  // Mismo criterio que listInsumos: el ledger local no alcanza (una tablet que
  // no genero la historia tiene cero filas), asi que se junta con la serie que
  // se bajo de la nube, prefiriendo lo local cuando hay de la misma fecha.
  let serieRemota = serieNube?.serie || [];
  if (serieRemota.length === 0) {
    serieRemota = (await sincronizarSerieConsumo({ hasta: hoy }).catch(() => null))?.serie || [];
  }
  const vistos = new Set(movimientosLocales.map(m => `${m.insumoId}|${String(m.fecha || "").slice(0, 10)}`));
  const movimientos = movimientosLocales.concat(
    serieRemota
      .filter(pt => !vistos.has(`${pt.insumoId}|${pt.fecha}`))
      .map(pt => ({ insumoId: pt.insumoId, tipo: "venta", cantidad: -pt.cantidad, fecha: pt.fecha }))
  );

  const series = serieDeConsumo(movimientos, { desde: sumarDiasISO(hoy, -56), hasta: hoy });
  const perfilLocal = perfilSemanalDelLocal([...series.values()]);

  const demandaPorInsumo = pedidos
    ? demandaConocidaPorInsumo({ pedidos, recetas, hoy, hastaFecha: sumarDiasISO(hoy, 30) })
    : null;

  const proveedoresById = new Map(proveedores.filter(p => p.activo).map(p => [p.id, p]));
  const activePI = proveedorInsumos.filter(pi => pi.activo && pi.insumoId);

  const items = insumos
    .filter(i => i.activo)
    .map(insumo => {
      const serie = series.get(insumo.id) || [];
      const perfil = serie.length > 0 ? perfilSemanalMezclado(serie, perfilLocal) : perfilLocal;
      const tasaBase = tasaBaseDiaria(serie, perfil, alphaDiariaDesde(insumo.alphaPrediccion ?? 0.5));
      // Devuelve un objeto { sigma, cv, dias, usoPiso }, no un numero: pasarlo
      // entero hacia NaN el stock de seguridad y, en cascada, la app pedia 0
      // de absolutamente todo sin avisar.
      const variabilidad = variabilidadDiaria(serie, perfil, tasaBase);
      const sigmaDiaria = variabilidad.sigma;

      // Sin consumo medido queda el ultimo recurso de siempre. Se marca como
      // estimado para que la pantalla pueda decir que es una suposicion y no
      // un dato, que es justo lo que el modelo viejo no hacia.
      const consumoEstimado = tasaBase > 0 ? 0 : (insumo.stockMinimo > 0 ? insumo.stockMinimo / 7 : 0);
      const consumoDiario = tasaBase > 0 ? tasaBase : consumoEstimado;
      const consumoEsEstimado = tasaBase <= 0;

      // Lo ya comprometido en pedidos de clientes no esta disponible.
      const comprometido = demandaPorInsumo?.[insumo.id]?.total ?? 0;
      const stockLibre = Math.max(0, (Number(insumo.stockActual) || 0) - comprometido);

      const diasRestantes = consumoDiario > 0 ? Math.round(stockLibre / consumoDiario) : null;
      const estadoStock = insumo.stockActual <= insumo.stockCritico ? "critico"
        : insumo.stockActual <= insumo.stockMinimo ? "bajo" : "ok";

      const suppliers = activePI
        .filter(pi => pi.insumoId === insumo.id)
        .map(pi => {
          const prov = proveedoresById.get(pi.proveedorId);
          if (!prov) return null;
          const sug = sugerirCompra({
            hoy,
            stockActual: stockLibre,
            tasaBase: consumoDiario,
            perfil,
            sigmaDiaria,
            proveedor: prov,
            cantidadPorUnidad: pi.cantidadPorUnidad,
            precioUnitarioCentavos: pi.precioUnitarioCentavos
          });
          return {
            proveedorId: prov.id,
            proveedorNombre: prov.nombre,
            diasCiclo: prov.diasCiclo ?? 7,
            leadTimeDias: Number(prov.leadTimeDias) || 0,
            productoNombre: pi.nombreProducto,
            unidadCompra: pi.unidadCompra,
            cantidadAPedir: sug.faltante,
            cantidadEnCompra: sug.unidades,
            costoTotalCentavos: sug.costoTotalCentavos,
            costoPorUnidadBase: pi.precioUnitarioCentavos / pi.cantidadPorUnidad,
            llegadaEstaOrden: sug.llegadaEstaOrden,
            diasHastaLlegada: sug.diasHastaLlegada,
            diasACubrir: sug.diasACubrir,
            demandaVentana: sug.demandaVentana,
            seguridad: sug.seguridad,
            excedentePorEnvase: sug.excedentePorEnvase,
            coberturaFinalDias: sug.coberturaFinalDias
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.costoPorUnidadBase - b.costoPorUnidadBase);

      const mejorSupplier = suppliers[0] ?? null;

      // La urgencia la decide el proveedor que llega ANTES, no el mas barato:
      // para saber si llego, lo que importa es cuando entra lo mas rapido.
      const masRapido = suppliers.reduce((m, s) => (m && m.diasHastaLlegada <= s.diasHastaLlegada ? m : s), null);
      const urgencia = masRapido
        ? clasificarUrgencia({
            diasDeStockRestantes: diasRestantes,
            diasHastaLlegada: masRapido.diasHastaLlegada,
            diasACubrir: masRapido.diasACubrir,
            estadoStock
          })
        : (estadoStock === "critico" ? "urgente" : estadoStock === "bajo" ? "pronto" : "ok");

      return { ...insumo, consumoDiario, consumoEsEstimado, comprometidoEnPedidos: comprometido,
               diasRestantes, estadoStock, urgencia, suppliers, mejorSupplier };
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

  // INCIDENTE (04/10/2026): este movimiento se guardaba SOLO en la tablet y
  // nunca se sincronizaba. Como el stock de la nube se calcula unicamente
  // sumando movimientos_insumos (migracion 012), una compra cargada a mano no
  // cambiaba nada alla — y en la siguiente alineacion
  // (reconciliarStockInsumosConNube) el stock local volvia al de la nube, o
  // sea que la compra se perdia sin dejar rastro. Todo movimiento que mueve
  // stock tiene que viajar.
  const movimiento = { uuid: crypto.randomUUID(), insumoId, tipo, cantidad, stockAnterior, stockNuevo, fecha, creadoEn: now };

  // Escribir sincrónico — sin await adentro
  await withStores(["insumos", "movimientos_insumos"], "readwrite", (stores) => {
    stores.insumos.put({ ...insumo, stockActual: stockNuevo, ultimaCalibracion, actualizadoEn: now });
    stores.movimientos_insumos.add(movimiento);
  });

  trySyncMovimientosInsumos([movimiento]).catch(() => {});
  return movimiento;
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

  // Sync asíncrono — no bloquea la UI aunque Supabase falle.
  //
  // Todo lo que sigue va DESPUES del await, nunca adentro del callback: la
  // cola se escribe antes de enviar, pero tiene que escribirse cuando la
  // transaccion local ya commiteo. Al reves, una transaccion que abortara
  // (cuota de IndexedDB, un add que falla) dejaba el movimiento igual en la
  // cola: subia a la nube un movimiento que en este dispositivo no existe, y
  // la reconciliacion despues bajaba ese fantasma.
  const [syncInsumos, syncRecetas] = await Promise.all([getAll("insumos"), getAll("recetas")]);

  // El stock y la marca de calibrado cambian SIEMPRE que se calibra, haya o no
  // datos para recalcular el modelo. Por eso estas dos no van dentro del if:
  // una calibracion sin historial suficiente igual mueve el stock y pone
  // necesitaCalibracion en false, y eso tiene que llegar a los demas.
  trySyncMovimientosInsumos([movimiento]).catch(() => {});
  trySyncInsumosSnapshot(syncInsumos).catch(() => {});

  // Esto si depende de que el modelo se haya recalculado.
  if (eventoCalib) {
    trySyncCalibracion(eventoCalib).catch(() => {});
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
    porProducto.get(r.productoId).push({
      ...r,
      insumoNombre: insumo.nombre,
      unidad: insumo.unidad,
      unidadCompra: insumo.unidadCompra,
      factorConversion: insumo.factorConversion,
      historial
    });
  }

  return Array.from(porProducto.entries())
    .map(([productoId, recetasDelProducto]) => ({
      productoId,
      productoNombre: productoMap.get(productoId)?.nombre ?? productoId,
      recetas: recetasDelProducto
    }))
    .sort((a, b) => a.productoNombre.localeCompare(b.productoNombre));
}

// Crea la linea de receta que faltaba (ver el aviso de ciclo incompleto en
// Insumos). Es alta, no edicion: si ya existiera, se corrige desde Recetas.
export async function crearLineaReceta({ productoId, insumoId, cantidadPorUnidad }) {
  const cantidad = Number(cantidadPorUnidad);
  if (!productoId || !insumoId) throw new Error("Faltan el producto o el insumo.");
  if (!Number.isFinite(cantidad) || cantidad <= 0) throw new Error("La cantidad tiene que ser mayor que cero.");

  const id = `${productoId}:${insumoId}`;
  const existente = await getOne("recetas", id);
  if (existente) throw new Error("Ese producto ya usa este insumo.");

  const now = new Date().toISOString();
  await withStores(["recetas"], "readwrite", (stores) => {
    // esEstimado: lo escribio una persona, asi que el modelo no lo trata como
    // una estimacion suya (mismo criterio que actualizarReceta).
    stores.recetas.put({ id, productoId, insumoId, cantidadPorUnidad: cantidad, esEstimado: false, creadoEn: now, actualizadoEn: now });
  });

  trySyncRecetasSnapshot(await getAll("recetas")).catch(() => {});
  return id;
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
  // Y la receta en si. Antes subia solo el log del cambio: la nube quedaba
  // diciendo "paso de 20 a 25" con la receta todavia en 20, y el proximo
  // "Actualizar catalogo" revertia la edicion (pullCatalogoDesdeNube reescribe
  // recetas sin proteger nada). De paso, deductInsumosInTx seguia descontando
  // con la cantidad vieja.
  const recetasFinal = await getAll("recetas");
  trySyncRecetasSnapshot(recetasFinal).catch(() => {});
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
        unidadCompra: insumo.unidadCompra,
        factorConversion: insumo.factorConversion,
        stockActual: insumo.stockActual,
        necesita: total,
        // Lo que hay que comprar o cargar. Es el numero accionable: el
        // "quedaria en -150" describe el sintoma, este dice que hacer.
        falta: Math.abs(stockResultante),
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
