import { getAll, getOne, putOne, withStores } from "../db/idb.js";
import { PROVEEDORES_SEED_VERSION, initialProveedores, initialProveedorInsumos } from "./seed.js";

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

export async function saveProveedorInsumo(data) {
  const id = data.id ?? `${data.proveedorId}:custom-${Date.now()}`;
  const current = data.id ? (await getOne("proveedor_insumos", data.id) ?? {}) : {};
  await putOne("proveedor_insumos", { ...current, ...data, id, activo: true });
}

export async function deleteProveedorInsumo(id) {
  const current = await getOne("proveedor_insumos", id);
  if (!current) return;
  await putOne("proveedor_insumos", { ...current, activo: false });
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
