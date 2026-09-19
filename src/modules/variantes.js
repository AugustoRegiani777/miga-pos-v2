// Grupos de variantes (ej: "Tipo de leche") para productos vendidos con una
// opcion a elegir en caja. Antes esto era un solo grupo hardcodeado en el
// codigo (OPCIONES_LECHE en app.js, INSUMO_POR_OPCION_LECHE en
// aprovisionamiento.js) — ahora es una LISTA de grupos, editable desde
// Gestion > Variantes, guardada en el store generico "configuracion" bajo
// una sola fila (no hizo falta agregar un store nuevo ni tocar DB_VERSION).
import { getOne, putOne, getAll, withStores } from "../db/idb.js";
import { construirInsumoNuevo } from "./aprovisionamiento.js";
import { trySyncInsumosSnapshot, trySyncVariantesGrupos } from "./sync.js";
import { fetchVariantesGrupos } from "../db/supabase.js";
import { slugify } from "../utils/format.js";

const CONFIG_ID = "variantes_grupos";

// Mismo dataset con el que arranco el sistema — se usa como default hasta
// que se guarde algo desde la pantalla nueva.
const DEFAULT_GRUPOS = [
  {
    id: "leche",
    nombre: "Tipo de leche",
    titulo: "¿Con qué leche?",
    opciones: [
      { nombre: "Entera", insumoId: "leche-normal" },
      { nombre: "Avena", insumoId: "leche-avena" },
      { nombre: "Sin lactosa", insumoId: "leche-sin-lactosa" }
    ],
    productoIds: ["latte", "cafe-con-leche", "promo-cafe-con-leche", "capuccino", "cortado", "flat-white", "ice-latte", "ice-caramel"]
  }
];

export async function getGruposVariantes() {
  const row = await getOne("configuracion", CONFIG_ID);
  return row?.valor || DEFAULT_GRUPOS;
}

export async function getGrupoVariante(grupoId) {
  const grupos = await getGruposVariantes();
  return grupos.find((g) => g.id === grupoId) || null;
}

// A que grupo (si hay alguno) pertenece un producto puntual — para
// precargar el desplegable "Variante" al editar un producto en Menu.
export async function getGrupoDeProducto(productoId) {
  const grupos = await getGruposVariantes();
  return grupos.find((g) => g.productoIds.includes(productoId)) || null;
}

// Guarda (crea o edita) UN grupo dentro de la lista completa. opciones:
// [{ nombre, insumoId }] — insumoId puede venir como "__nuevo__" con
// nuevoInsumo:{nombre,unidad,stockMinimo,stockCritico} para crear el insumo
// ahi mismo (mismo mecanismo que Menu/Proveedores/Factura).
export async function saveGrupoVariante({ id, nombre, titulo, opciones, productoIds }) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("El nombre del grupo es obligatorio.");

  const grupos = await getGruposVariantes();
  const insumosActuales = await getAll("insumos");
  const idsInsumoUsados = new Set(insumosActuales.map((i) => i.id));
  const insumosNuevos = [];

  const opcionesFinales = (opciones || [])
    .filter((o) => o.nombre?.trim() && (o.insumoId === "__nuevo__" ? o.nuevoInsumo?.nombre?.trim() : o.insumoId))
    .map((o) => {
      if (o.insumoId === "__nuevo__") {
        const insumo = construirInsumoNuevo(o.nuevoInsumo.nombre, idsInsumoUsados, {
          unidad: o.nuevoInsumo.unidad,
          stockMinimo: o.nuevoInsumo.stockMinimo,
          stockCritico: o.nuevoInsumo.stockCritico
        });
        insumosNuevos.push(insumo);
        return { nombre: o.nombre.trim(), insumoId: insumo.id };
      }
      return { nombre: o.nombre.trim(), insumoId: o.insumoId };
    });

  if (insumosNuevos.length > 0) {
    await withStores(["insumos"], "readwrite", (stores) => {
      for (const insumo of insumosNuevos) stores.insumos.put(insumo);
    });
    const insumosFinal = await getAll("insumos");
    trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  }

  let grupoId = id;
  if (!grupoId) {
    const idsGrupoUsados = new Set(grupos.map((g) => g.id));
    grupoId = slugify(nombreLimpio);
    let sufijo = 2;
    while (idsGrupoUsados.has(grupoId)) {
      grupoId = `${slugify(nombreLimpio)}-${sufijo}`;
      sufijo += 1;
    }
  }

  const grupoGuardado = {
    id: grupoId,
    nombre: nombreLimpio,
    titulo: String(titulo || "").trim() || `¿Qué ${nombreLimpio.toLowerCase()}?`,
    opciones: opcionesFinales,
    productoIds: productoIds || []
  };

  const index = grupos.findIndex((g) => g.id === grupoId);
  const gruposFinal = index >= 0
    ? grupos.map((g, i) => (i === index ? grupoGuardado : g))
    : [...grupos, grupoGuardado];

  await putOne("configuracion", { id: CONFIG_ID, valor: gruposFinal, actualizadoEn: new Date().toISOString() });
  trySyncVariantesGrupos(gruposFinal).catch(() => {});
  return grupoGuardado;
}

export async function deleteGrupoVariante(grupoId) {
  const grupos = await getGruposVariantes();
  const gruposFinal = grupos.filter((g) => g.id !== grupoId);
  await putOne("configuracion", { id: CONFIG_ID, valor: gruposFinal, actualizadoEn: new Date().toISOString() });
  trySyncVariantesGrupos(gruposFinal).catch(() => {});
  return gruposFinal;
}

// Asigna (o saca) un producto de un grupo — usado desde el desplegable
// "Variante" del formulario de Menu, sin pasar por la pantalla de Variantes.
// grupoId null/"" saca al producto de cualquier grupo al que pertenezca.
export async function setProductoGrupoVariante(productoId, grupoId) {
  const grupos = await getGruposVariantes();
  const gruposFinal = grupos.map((g) => ({
    ...g,
    productoIds: g.id === grupoId
      ? Array.from(new Set([...g.productoIds, productoId]))
      : g.productoIds.filter((id) => id !== productoId)
  }));
  await putOne("configuracion", { id: CONFIG_ID, valor: gruposFinal, actualizadoEn: new Date().toISOString() });
  trySyncVariantesGrupos(gruposFinal).catch(() => {});
  return gruposFinal;
}

// Trae los grupos de variante desde Supabase (ver "Actualizar catalogo" en
// Gestion) y reemplaza la fila local entera — es config editada rara vez
// (alta/edicion manual desde Gestion > Variantes), no hay ningun campo en
// vivo que proteger aca como si pasa con stockActual en insumos/productos.
export async function pullVariantesGruposDesdeNube() {
  const remoto = await fetchVariantesGrupos();
  if (!remoto?.valor) return { aplicado: false, grupos: 0 };
  await putOne("configuracion", {
    id: CONFIG_ID,
    valor: remoto.valor,
    actualizadoEn: remoto.actualizado_en || new Date().toISOString()
  });
  return { aplicado: true, grupos: remoto.valor.length };
}

// Para el resumen de receta en Gestion > Menu: insumoId -> nombre del grupo
// de variante al que pertenece (ej. "leche-normal" -> "Tipo de leche") — asi
// se muestra el nombre generico del GRUPO en vez del insumo puntual del
// default, sea cual sea el grupo (leche, pan, o lo que se agregue despues).
export async function getInsumoAGrupoVariante() {
  const grupos = await getGruposVariantes();
  const mapa = new Map();
  for (const grupo of grupos) {
    for (const opcion of grupo.opciones) {
      mapa.set(opcion.insumoId, grupo.nombre);
    }
  }
  return mapa;
}
