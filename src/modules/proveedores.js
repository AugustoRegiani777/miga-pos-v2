import { getAll, getOne, putOne, withStores } from "../db/idb.js";
import { PROVEEDORES_SEED_VERSION, initialProveedores, initialProveedorInsumos } from "./seed.js";
import { fetchProveedoresCatalogo, fetchProveedorInsumosCatalogo } from "../db/supabase.js";
import { slugify } from "../utils/format.js";
import { trySyncProveedoresSnapshot, trySyncProveedorInsumosSnapshot, trySyncInsumosSnapshot, trySyncRecetasSnapshot } from "./sync.js";

export async function createProveedor({ nombre, tel, email, notas, diasCiclo }) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("El nombre del proveedor es obligatorio.");

  const existentes = await getAll("proveedores");
  const idsUsados = new Set(existentes.map((p) => p.id));
  let id = slugify(nombreLimpio);
  let sufijo = 2;
  while (idsUsados.has(id)) {
    id = `${slugify(nombreLimpio)}-${sufijo}`;
    sufijo += 1;
  }

  const proveedor = {
    id,
    nombre: nombreLimpio,
    tel: tel || "",
    email: email || "",
    notas: notas || "",
    diasCiclo: Number(diasCiclo) || 7,
    activo: true
  };
  await putOne("proveedores", proveedor);

  const proveedores = await getAll("proveedores");
  trySyncProveedoresSnapshot(proveedores).catch(() => {});

  return proveedor;
}

// Trae proveedores y proveedor_insumos desde Supabase (ver "Actualizar
// catalogo" en Gestion) — sin campos en vivo que proteger aca, es un
// reemplazo directo de lo local por lo que haya en la nube.
export async function pullProveedoresDesdeNube() {
  const [proveedoresRemotos, proveedorInsumosRemotos] = await Promise.all([
    fetchProveedoresCatalogo(),
    fetchProveedorInsumosCatalogo()
  ]);

  await withStores(["proveedores", "proveedor_insumos"], "readwrite", (stores) => {
    for (const p of proveedoresRemotos) {
      stores.proveedores.put({
        id: p.id,
        nombre: p.nombre,
        tel: p.tel || "",
        email: p.email || "",
        notas: p.notas || "",
        diasCiclo: p.dias_ciclo,
        activo: p.activo
      });
    }
    for (const pi of proveedorInsumosRemotos) {
      stores.proveedor_insumos.put({
        id: pi.id,
        proveedorId: pi.proveedor_id,
        insumoId: pi.insumo_id || null,
        nombreProducto: pi.nombre_producto || "",
        unidadCompra: pi.unidad_compra || "",
        cantidadPorUnidad: pi.cantidad_por_unidad,
        precioUnitarioCentavos: pi.precio_unitario_centavos,
        activo: pi.activo
      });
    }
  });

  return { proveedores: proveedoresRemotos.length, proveedorInsumos: proveedorInsumosRemotos.length };
}

export async function seedProveedores() {
  const [config, existingProv, existingPI] = await Promise.all([
    getAll("configuracion"),
    getAll("proveedores"),
    getAll("proveedor_insumos")
  ]);

  const current = config.find(c => c.id === "proveedores_seed_version");
  if (current?.valor >= PROVEEDORES_SEED_VERSION) return;

  // Solo inserta registros nuevos — no sobreescribe ediciones del usuario
  const provIds = new Set(existingProv.map(p => p.id));
  const piIds = new Set(existingPI.map(pi => pi.id));

  // IDs de seed obsoletos que deben eliminarse (renombrados o corregidos)
  const piObsoletos = ["jasa:jamon-york"];

  await withStores(["proveedores", "proveedor_insumos", "configuracion"], "readwrite", (stores) => {
    for (const p of initialProveedores) {
      if (!provIds.has(p.id)) stores.proveedores.put(p);
    }
    for (const id of piObsoletos) {
      stores.proveedor_insumos.delete(id);
    }
    for (const pi of initialProveedorInsumos) {
      if (!piIds.has(pi.id)) stores.proveedor_insumos.put(pi);
    }
    stores.configuracion.put({ id: "proveedores_seed_version", valor: PROVEEDORES_SEED_VERSION });
  });
}

export async function updateProveedor(id, changes) {
  const current = await getOne("proveedores", id);
  if (!current) throw new Error("Proveedor no encontrado.");
  await putOne("proveedores", { ...current, ...changes });
}

// data.insumoId === "__nuevo__" crea el insumo ahi mismo (mismo mecanismo de
// slugify + resolucion de colision que ya usan facturas.js y menu.js) — en
// ese caso data.nuevoInsumo trae { nombre, unidad, stockMinimo, stockCritico }.
// data.recetasVinculadas, opcional y solo tiene sentido junto con un insumo
// nuevo, trae [{ productoId, cantidad }, ...] para que nazca ya enganchado a
// la receta de uno o varios productos de una (ej: leche de soja entra en
// varios cafes a la vez).
export async function saveProveedorInsumo(data) {
  const now = new Date().toISOString();
  const esInsumoNuevo = data.insumoId === "__nuevo__";

  let insumoIdFinal = data.insumoId || null;
  let insumoNuevoCreado = null;

  if (esInsumoNuevo) {
    const nombreInsumo = String(data.nuevoInsumo?.nombre || "").trim();
    if (!nombreInsumo) throw new Error("El nombre del insumo nuevo es obligatorio.");
    const insumosActuales = await getAll("insumos");
    const idsUsados = new Set(insumosActuales.map((i) => i.id));
    let insumoId = slugify(nombreInsumo);
    let sufijo = 2;
    while (idsUsados.has(insumoId)) {
      insumoId = `${slugify(nombreInsumo)}-${sufijo}`;
      sufijo += 1;
    }
    insumoIdFinal = insumoId;
    const unidad = data.nuevoInsumo.unidad?.trim() || "unidad";
    insumoNuevoCreado = {
      id: insumoId,
      nombre: nombreInsumo,
      unidad,
      unidadCompra: unidad,
      factorConversion: 1,
      stockActual: 0,
      stockMinimo: parseFloat(String(data.nuevoInsumo.stockMinimo ?? "").replace(",", ".")) || 0,
      stockCritico: parseFloat(String(data.nuevoInsumo.stockCritico ?? "").replace(",", ".")) || 0,
      activo: true,
      creadoEn: now,
      actualizadoEn: now
    };
  }

  const id = data.id ?? (insumoNuevoCreado ? `${data.proveedorId}:${insumoIdFinal}` : `${data.proveedorId}:custom-${Date.now()}`);
  const current = data.id ? (await getOne("proveedor_insumos", data.id) ?? {}) : {};
  const proveedorInsumo = {
    ...current,
    id,
    proveedorId: data.proveedorId,
    insumoId: insumoIdFinal,
    nombreProducto: data.nombreProducto,
    unidadCompra: data.unidadCompra,
    cantidadPorUnidad: data.cantidadPorUnidad,
    precioUnitarioCentavos: data.precioUnitarioCentavos,
    activo: true
  };

  const recetasCreadas = insumoNuevoCreado
    ? (data.recetasVinculadas || [])
        .filter((v) => v.productoId && parseFloat(String(v.cantidad ?? "").replace(",", ".")) > 0)
        .map((v) => ({
          id: `${v.productoId}:${insumoIdFinal}`,
          productoId: v.productoId,
          insumoId: insumoIdFinal,
          cantidadPorUnidad: parseFloat(String(v.cantidad).replace(",", ".")),
          esEstimado: true,
          creadoEn: now,
          actualizadoEn: now
        }))
    : [];

  const storeNames = ["proveedor_insumos"];
  if (insumoNuevoCreado) storeNames.push("insumos");
  if (recetasCreadas.length > 0) storeNames.push("recetas");

  await withStores(storeNames, "readwrite", (stores) => {
    if (insumoNuevoCreado) stores.insumos.put(insumoNuevoCreado);
    stores.proveedor_insumos.put(proveedorInsumo);
    for (const receta of recetasCreadas) stores.recetas.put(receta);
  });

  const proveedorInsumosFinal = await getAll("proveedor_insumos");
  trySyncProveedorInsumosSnapshot(proveedorInsumosFinal).catch(() => {});
  if (insumoNuevoCreado) {
    const insumosFinal = await getAll("insumos");
    trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  }
  if (recetasCreadas.length > 0) {
    const recetasFinal = await getAll("recetas");
    trySyncRecetasSnapshot(recetasFinal).catch(() => {});
  }

  return proveedorInsumo;
}

export async function deleteProveedorInsumo(id) {
  const current = await getOne("proveedor_insumos", id);
  if (!current) return;
  await putOne("proveedor_insumos", { ...current, activo: false });
  const proveedorInsumosFinal = await getAll("proveedor_insumos");
  trySyncProveedorInsumosSnapshot(proveedorInsumosFinal).catch(() => {});
}

export async function getProveedoresDashboardData() {
  const [proveedores, proveedorInsumos, insumos] = await Promise.all([
    getAll("proveedores"),
    getAll("proveedor_insumos"),
    getAll("insumos")
  ]);

  const insumosById = new Map(insumos.map(i => [i.id, i]));
  const activeProductos = proveedorInsumos.filter(pi => pi.activo);

  // Build cheapest-per-insumo map: insumoId → min centavos/cantidadPorUnidad
  const precioBase = new Map();
  for (const pi of activeProductos) {
    if (!pi.insumoId) continue;
    const costo = pi.precioUnitarioCentavos / pi.cantidadPorUnidad;
    const prev = precioBase.get(pi.insumoId);
    if (prev === undefined || costo < prev) precioBase.set(pi.insumoId, costo);
  }

  return proveedores
    .filter(p => p.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
    .map(proveedor => {
      const productos = activeProductos
        .filter(pi => pi.proveedorId === proveedor.id)
        .map(pi => {
          const insumo = insumosById.get(pi.insumoId) ?? null;
          const costoPorUnidad = pi.precioUnitarioCentavos / pi.cantidadPorUnidad;
          const esMasBarato = pi.insumoId
            ? Math.abs(costoPorUnidad - (precioBase.get(pi.insumoId) ?? costoPorUnidad)) < 0.001
            : false;
          const hayCompetencia = pi.insumoId
            ? activeProductos.filter(x => x.insumoId === pi.insumoId).length > 1
            : false;
          return { ...pi, insumo, costoPorUnidad, esMasBarato: esMasBarato && hayCompetencia };
        });
      return { ...proveedor, productos };
    });
}
