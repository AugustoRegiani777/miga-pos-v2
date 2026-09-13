import { getAll, getOne, putOne, withStores } from "../db/idb.js";
import { slugify } from "../utils/format.js";
import { trySyncCatalogoSnapshot, trySyncRecetasSnapshot, trySyncInsumosSnapshot } from "./sync.js";
import { fetchCategoriasCatalogo, fetchProductosCatalogo, fetchRecetasCatalogo } from "../db/supabase.js";

export async function getMenuDashboardData() {
  const [categorias, productos, recetas, insumos] = await Promise.all([
    getAll("categorias"),
    getAll("productos"),
    getAll("recetas"),
    getAll("insumos")
  ]);
  const insumosById = new Map(insumos.map(i => [i.id, i]));
  const recetasPorProducto = new Map();
  for (const r of recetas) {
    if (!recetasPorProducto.has(r.productoId)) recetasPorProducto.set(r.productoId, []);
    recetasPorProducto.get(r.productoId).push(r);
  }

  return categorias
    .sort((a, b) => a.orden - b.orden)
    .map(categoria => {
      const productosCategoria = productos
        .filter(p => p.categoriaId === categoria.id)
        .sort((a, b) => a.orden - b.orden)
        .map(producto => {
          const recetaResumen = (recetasPorProducto.get(producto.id) || [])
            .map(r => insumosById.get(r.insumoId)?.nombre)
            .filter(Boolean);
          return { ...producto, recetaResumen };
        });
      return { ...categoria, productos: productosCategoria };
    });
}

function proximoOrden(productos, categoriaId) {
  const ordenes = productos.filter(p => p.categoriaId === categoriaId).map(p => p.orden || 0);
  return ordenes.length ? Math.max(...ordenes) + 1 : 1;
}

// Guarda un producto (alta o edicion) junto con su receta completa. Las
// lineas de receta que apunten a un insumo inexistente lo crean ahi mismo —
// mismo mecanismo de slugify + resolucion de colision que ya usa
// confirmarFactura() en facturas.js.
export async function saveProducto({ id, categoriaId, nombre, precioCentavos, controlaStock, umbralBajo, sandwichTipo, activo, lineasReceta }) {
  const now = new Date().toISOString();
  const [productosActuales, insumosActuales, recetasActuales] = await Promise.all([
    getAll("productos"),
    getAll("insumos"),
    getAll("recetas")
  ]);

  const existente = id ? productosActuales.find(p => p.id === id) : null;
  let productoId = id;
  if (!productoId) {
    const idsUsados = new Set(productosActuales.map(p => p.id));
    productoId = slugify(nombre);
    let sufijo = 2;
    while (idsUsados.has(productoId)) {
      productoId = `${slugify(nombre)}-${sufijo}`;
      sufijo += 1;
    }
  }

  const producto = {
    id: productoId,
    categoriaId,
    nombre,
    precioCentavos,
    controlaStock,
    umbralBajo: umbralBajo || 0,
    stockActual: existente?.stockActual ?? 0,
    orden: existente && existente.categoriaId === categoriaId ? existente.orden : proximoOrden(productosActuales, categoriaId),
    activo,
    actualizadoEn: now,
    ...(categoriaId === "sandwiches" ? { sandwichTipo: sandwichTipo === "premium" ? "premium" : "basico" } : {}),
    ...(existente ? {} : { creadoEn: now })
  };

  const idsInsumoUsados = new Set(insumosActuales.map(i => i.id));
  const insumosNuevos = [];

  const cantidadDecimal = (l) => parseFloat(String(l.cantidad ?? "").replace(",", "."));

  const lineasFinales = (lineasReceta || [])
    .filter(l => (l.insumoId === "__nuevo__" ? l.nuevoNombre?.trim() : l.insumoId) && cantidadDecimal(l) > 0)
    .map(l => {
      if (l.insumoId === "__nuevo__") {
        let insumoId = slugify(l.nuevoNombre);
        let sufijo = 2;
        while (idsInsumoUsados.has(insumoId)) {
          insumoId = `${slugify(l.nuevoNombre)}-${sufijo}`;
          sufijo += 1;
        }
        idsInsumoUsados.add(insumoId);
        insumosNuevos.push({
          id: insumoId,
          nombre: l.nuevoNombre.trim(),
          unidad: l.nuevaUnidad?.trim() || "unidad",
          unidadCompra: l.nuevaUnidad?.trim() || "unidad",
          factorConversion: 1,
          stockActual: 0,
          stockMinimo: parseFloat(String(l.nuevoStockMinimo ?? "").replace(",", ".")) || 0,
          stockCritico: parseFloat(String(l.nuevoStockCritico ?? "").replace(",", ".")) || 0,
          activo: true,
          creadoEn: now,
          actualizadoEn: now
        });
        return { insumoId, cantidadPorUnidad: cantidadDecimal(l) };
      }
      return { insumoId: l.insumoId, cantidadPorUnidad: cantidadDecimal(l) };
    });

  const recetasDelProducto = recetasActuales.filter(r => r.productoId === productoId);

  await withStores(["productos", "insumos", "recetas"], "readwrite", (stores) => {
    stores.productos.put(producto);
    for (const insumo of insumosNuevos) stores.insumos.put(insumo);
    for (const receta of recetasDelProducto) stores.recetas.delete(receta.id);
    for (const linea of lineasFinales) {
      stores.recetas.put({
        id: `${productoId}:${linea.insumoId}`,
        productoId,
        insumoId: linea.insumoId,
        cantidadPorUnidad: linea.cantidadPorUnidad,
        esEstimado: true,
        creadoEn: now,
        actualizadoEn: now
      });
    }
  });

  const [categorias, productosFinal, recetasFinal, insumosFinal] = await Promise.all([
    getAll("categorias"),
    getAll("productos"),
    getAll("recetas"),
    getAll("insumos")
  ]);
  trySyncCatalogoSnapshot(categorias, productosFinal).catch(() => {});
  trySyncRecetasSnapshot(recetasFinal).catch(() => {});
  if (insumosNuevos.length > 0) trySyncInsumosSnapshot(insumosFinal).catch(() => {});

  return producto;
}

// Trae categorias/productos/recetas desde Supabase y los fusiona con lo
// local — para que un producto creado en OTRO dispositivo (ej. el celu)
// aparezca en este. Nunca toca stockActual: ese campo es en vivo, cambia con
// cada venta/produccion de ESTE dispositivo, y no viaja por esta via (ver
// pushCatalogoSnapshot, que ni siquiera lo manda a Supabase).
export async function pullCatalogoDesdeNube() {
  const [categoriasRemotas, productosRemotos, recetasRemotas, categoriasLocales, productosLocales] = await Promise.all([
    fetchCategoriasCatalogo(),
    fetchProductosCatalogo(),
    fetchRecetasCatalogo(),
    getAll("categorias"),
    getAll("productos")
  ]);
  const categoriasLocalesById = new Map(categoriasLocales.map(c => [c.id, c]));
  const productosLocalesById = new Map(productosLocales.map(p => [p.id, p]));

  await withStores(["categorias", "productos", "recetas"], "readwrite", (stores) => {
    for (const c of categoriasRemotas) {
      stores.categorias.put({
        ...(categoriasLocalesById.get(c.id) || {}),
        id: c.id,
        nombre: c.nombre,
        orden: c.orden
      });
    }
    for (const p of productosRemotos) {
      stores.productos.put({
        ...(productosLocalesById.get(p.id) || { stockActual: 0 }),
        id: p.id,
        categoriaId: p.categoria_id,
        nombre: p.nombre,
        precioCentavos: p.precio_centavos,
        sandwichTipo: p.sandwich_tipo || undefined,
        umbralBajo: p.umbral_bajo,
        controlaStock: p.controla_stock,
        orden: p.orden,
        activo: p.activo,
        actualizadoEn: new Date().toISOString()
        // stockActual deliberadamente ausente — sobrevive el spread de arriba.
      });
    }
    for (const r of recetasRemotas) {
      stores.recetas.put({
        id: r.id,
        productoId: r.producto_id,
        insumoId: r.insumo_id,
        cantidadPorUnidad: r.cantidad_por_unidad,
        esEstimado: r.es_estimado,
        actualizadoEn: r.actualizado_en || new Date().toISOString()
      });
    }
  });

  return { categorias: categoriasRemotas.length, productos: productosRemotos.length, recetas: recetasRemotas.length };
}

export async function setProductoActivo(id, activo) {
  const producto = await getOne("productos", id);
  if (!producto) throw new Error("Producto no encontrado.");
  await putOne("productos", { ...producto, activo, actualizadoEn: new Date().toISOString() });
  const [categorias, productos] = await Promise.all([getAll("categorias"), getAll("productos")]);
  trySyncCatalogoSnapshot(categorias, productos).catch(() => {});
}

export async function moverProductoOrden(id, direccion) {
  const producto = await getOne("productos", id);
  if (!producto) throw new Error("Producto no encontrado.");
  const hermanos = (await getAll("productos"))
    .filter(p => p.categoriaId === producto.categoriaId)
    .sort((a, b) => a.orden - b.orden);
  const index = hermanos.findIndex(p => p.id === id);
  const vecinoIndex = direccion === "up" ? index - 1 : index + 1;
  if (vecinoIndex < 0 || vecinoIndex >= hermanos.length) return;
  const vecino = hermanos[vecinoIndex];
  const ordenProducto = producto.orden;

  await withStores(["productos"], "readwrite", (stores) => {
    stores.productos.put({ ...producto, orden: vecino.orden });
    stores.productos.put({ ...vecino, orden: ordenProducto });
  });

  const [categorias, productos] = await Promise.all([getAll("categorias"), getAll("productos")]);
  trySyncCatalogoSnapshot(categorias, productos).catch(() => {});
}
