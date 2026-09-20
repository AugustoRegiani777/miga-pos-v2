import { getAll, getOne, putOne, withStores, requestToPromise } from "../db/idb.js";
import { slugify } from "../utils/format.js";
import { trySyncCatalogoSnapshot, trySyncRecetasSnapshot, trySyncInsumosSnapshot } from "./sync.js";
import { fetchCategoriasCatalogo, fetchProductosCatalogo, fetchRecetasCatalogo } from "../db/supabase.js";
import { construirInsumoNuevo } from "./aprovisionamiento.js";
import { getInsumoAGrupoVariante } from "./variantes.js";

export async function getMenuDashboardData() {
  const [categorias, productos, recetas, insumos, insumoAGrupo] = await Promise.all([
    getAll("categorias"),
    getAll("productos"),
    getAll("recetas"),
    getAll("insumos"),
    getInsumoAGrupoVariante()
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
          // Para insumos que son parte de un grupo de variante (ej. leche),
          // mostrar el nombre del GRUPO ("Tipo de leche") en vez del insumo
          // puntual (ej. "Leche entera") — la receta siempre apunta a ese por
          // defecto, pero en caja se puede vender con otra variante sin que
          // la receta en si cambie nunca. Mostrar el nombre puntual da a
          // entender que ese producto SOLO usa esa opcion, cosa que no es
          // cierta.
          const recetaResumen = (recetasPorProducto.get(producto.id) || [])
            .map(r => insumoAGrupo.get(r.insumoId) ?? insumosById.get(r.insumoId)?.nombre)
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

  // Overrides de cantidad por opcion de variante (ej. "Avena": 220) — solo
  // se guardan las que el usuario cargo con un numero valido > 0, el resto
  // (vacias o invalidas) caen y usan la cantidad base al vender.
  const variantesCantidadDecimal = (l) => {
    const overrides = l.variantesCantidad || {};
    const resultado = {};
    for (const [opcion, valor] of Object.entries(overrides)) {
      const num = parseFloat(String(valor ?? "").replace(",", "."));
      if (Number.isFinite(num) && num > 0) resultado[opcion] = num;
    }
    return resultado;
  };

  const lineasFinales = (lineasReceta || [])
    .filter(l => (l.insumoId === "__nuevo__" ? l.nuevoNombre?.trim() : l.insumoId) && cantidadDecimal(l) > 0)
    .map(l => {
      const variantesCantidad = variantesCantidadDecimal(l);
      if (l.insumoId === "__nuevo__") {
        const insumoNuevo = construirInsumoNuevo(l.nuevoNombre, idsInsumoUsados, {
          unidad: l.nuevaUnidad,
          stockMinimo: l.nuevoStockMinimo,
          stockCritico: l.nuevoStockCritico
        });
        insumosNuevos.push(insumoNuevo);
        return { insumoId: insumoNuevo.id, cantidadPorUnidad: cantidadDecimal(l), variantesCantidad };
      }
      return { insumoId: l.insumoId, cantidadPorUnidad: cantidadDecimal(l), variantesCantidad };
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
        ...(Object.keys(linea.variantesCantidad || {}).length ? { variantesCantidad: linea.variantesCantidad } : {}),
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
//
// OJO con esto — incidente real (19/09/2026): la version anterior leia el
// producto local ANTES de esperar la respuesta de red (fetchProductosCatalogo,
// etc.), y recien despues escribia usando ese dato ya viejo. Si en el medio
// (mientras se esperaba la red) se cargaba una venta o produccion en este
// mismo dispositivo — por ej. otra pestaña abierta — la escritura de esta
// funcion pisaba ese cambio con el stockActual de antes, haciendo que el
// stock "retrocediera" sin ningun aviso. La lectura que protege stockActual
// tiene que pasar DENTRO de la misma transaccion en la que se escribe, nunca
// minutos (ni milisegundos) antes.
export async function pullCatalogoDesdeNube() {
  const [categoriasRemotas, productosRemotos, recetasRemotas] = await Promise.all([
    fetchCategoriasCatalogo(),
    fetchProductosCatalogo(),
    fetchRecetasCatalogo()
  ]);

  await withStores(["categorias", "productos", "recetas"], "readwrite", async (stores) => {
    for (const c of categoriasRemotas) {
      const local = await requestToPromise(stores.categorias.get(c.id));
      stores.categorias.put({
        ...(local || {}),
        id: c.id,
        nombre: c.nombre,
        orden: c.orden
      });
    }
    for (const p of productosRemotos) {
      const local = await requestToPromise(stores.productos.get(p.id));
      stores.productos.put({
        ...(local || { stockActual: 0 }),
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
        ...(r.variantes_cantidad ? { variantesCantidad: r.variantes_cantidad } : {}),
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
