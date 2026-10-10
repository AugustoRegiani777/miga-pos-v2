import { getAll, getOne, putOne, withStores, requestToPromise } from "../db/idb.js";
import { slugify } from "../utils/format.js";
import { trySyncCatalogoSnapshot, trySyncRecetasSnapshot, trySyncInsumosSnapshot, trySyncProveedorInsumosSnapshot, trySyncProductoEliminado, hayPendientesDeTipo } from "./sync.js";
import { fetchCategoriasCatalogo, fetchProductosCatalogo, fetchRecetasCatalogo, contarReferenciasProducto, deleteProductoRemoto } from "../db/supabase.js";
import { construirInsumoNuevo } from "./aprovisionamiento.js";
import { getInsumoAGrupoVariante, setProductoGrupoVariante } from "./variantes.js";
import { clasificarBloqueosEliminacion, mensajeBloqueoEliminacion } from "./menu-calculos.js";

// Se reexporta para que app.js siga pidiendole todo lo del Menu a un solo
// modulo (los calculos puros viven aparte solo para poder probarlos sin
// navegador, no para que la pantalla tenga que saber de dos archivos).
export { mensajeBloqueoEliminacion };

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
          // recetaResumen sale vacio tambien cuando la receta apunta a un insumo
          // que ya no existe; "en prueba" es otra cosa: no tener NINGUNA linea.
          const tieneReceta = (recetasPorProducto.get(producto.id) || []).length > 0;
          return { ...producto, recetaResumen, tieneReceta };
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
// Un producto que se compra hecho y se vende tal cual (la Coca-Cola, la
// medialuna que trae Messialuncitas) es, a la vez, su propio insumo: hay UN
// insumo con el mismo id que el producto, y una receta de una unidad. No es un
// camino nuevo — es la misma maquinaria de siempre (receta -> insumo ->
// proveedor), y es lo que lo hace entrar en la lista de compras con su
// proveedor y su precio.
//
// El insumo se cuenta en unidades sueltas; cuantas trae una caja lo dice la
// linea de proveedor, no el insumo (CLAUDE.md 7: el envase del insumo y como lo
// vende el proveedor son dos cosas distintas y no se mezclan).
//
// Si el insumo ya existe (un producto que se dejo "en prueba" despues de haber
// sido de reventa, o viceversa) se REACTIVA en vez de crear otro: su historial
// de stock vive en el ledger y tiene que seguir siendo el mismo.
export function construirEspejoReventa({ producto, datos, insumoExistente, now }) {
  const insumo = insumoExistente
    ? { ...insumoExistente, activo: true, actualizadoEn: now }
    : { ...construirInsumoNuevo(producto.nombre, new Set(), { unidad: "unidad" }), id: producto.id };
  const receta = {
    id: `${producto.id}:${producto.id}`,
    productoId: producto.id,
    insumoId: insumo.id,
    cantidadPorUnidad: 1,
    esEstimado: false,
    creadoEn: now,
    actualizadoEn: now
  };
  const lineaProveedor = construirLineaProveedor({
    nuevoProveedorId: datos?.proveedorId,
    nuevoProveedorProducto: datos?.nombreProducto,
    nuevoProveedorUnidad: datos?.unidadCompra,
    nuevoProveedorTrae: datos?.cantidadPorUnidad,
    nuevoProveedorPrecio: datos?.precio
  }, insumo, now);
  return { insumo, receta, lineaProveedor };
}

// Define como "se compra hecho" un producto que todavia no tenia receta. Se usa
// desde el aviso "En prueba" de Insumos; el alta de producto hace lo mismo
// dentro de saveProducto.
export async function definirProductoComoReventa({ productoId, datos }) {
  const [producto, insumos, recetas] = await Promise.all([
    getOne("productos", productoId), getAll("insumos"), getAll("recetas")
  ]);
  if (!producto) throw new Error("Ese producto ya no existe.");
  if (recetas.some((r) => r.productoId === productoId)) {
    throw new Error("Este producto ya tiene receta. Para cambiarla, editalo desde Menú.");
  }
  const now = new Date().toISOString();
  const { insumo, receta, lineaProveedor } = construirEspejoReventa({
    producto, datos, insumoExistente: insumos.find((i) => i.id === productoId), now
  });

  await withStores(["productos", "insumos", "recetas", "proveedor_insumos"], "readwrite", (stores) => {
    // Lo que se compra hecho deja de aparecer en Produccion.
    stores.productos.put({ ...producto, controlaStock: false, actualizadoEn: now });
    stores.insumos.put(insumo);
    stores.recetas.put(receta);
    if (lineaProveedor) stores.proveedor_insumos.put(lineaProveedor);
  });

  // En este orden y esperando: la receta y la linea de proveedor referencian al
  // insumo por clave foranea, y Supabase rechaza el lote entero con un 409 si
  // el insumo todavia no llego.
  trySyncCatalogoSnapshot(await getAll("categorias"), await getAll("productos")).catch(() => {});
  await trySyncInsumosSnapshot(await getAll("insumos")).catch(() => {});
  await trySyncRecetasSnapshot(await getAll("recetas")).catch(() => {});
  if (lineaProveedor) trySyncProveedorInsumosSnapshot(await getAll("proveedor_insumos")).catch(() => {});
  return { insumo, lineaProveedor: Boolean(lineaProveedor) };
}

// La linea de proveedor que sale del alta de un insumo nuevo en Menu. Solo se
// crea si estan los cuatro datos que la hacen util: sin precio o sin cuanto
// trae, la lista de compras no puede ni comparar ni calcular, y seria una
// linea que ensucia sin servir. Si falta algo se ignora en silencio y el
// insumo queda "sin proveedor", que es lo que el aviso de Insumos ya marca.
function construirLineaProveedor(linea, insumo, now) {
  const proveedorId = String(linea.nuevoProveedorId || "").trim();
  if (!proveedorId) return null;
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
  const trae = num(linea.nuevoProveedorTrae);
  const precio = num(linea.nuevoProveedorPrecio);
  const unidadCompra = String(linea.nuevoProveedorUnidad || "").trim();
  if (!trae || !precio || !unidadCompra) return null;
  return {
    id: `${proveedorId}:${insumo.id}`,
    proveedorId,
    insumoId: insumo.id,
    nombreProducto: String(linea.nuevoProveedorProducto || "").trim() || insumo.nombre,
    unidadCompra,
    cantidadPorUnidad: trae,
    precioUnitarioCentavos: Math.round(precio * 100),
    activo: true,
    creadoEn: now,
    actualizadoEn: now
  };
}

// `modo` dice como se consigue el producto:
//   "receta"    (o sin modo) -> lo que venga en lineasReceta, como siempre
//   "reventa"   -> se compra hecho: crea su insumo espejo con su proveedor
//   "pendiente" -> "lo estoy probando": sin receta y sin insumos. Se puede
//                  producir y vender normal; solo no descuenta nada hasta que
//                  se lo defina. No es un error, y no rompe nada.
export async function saveProducto({ id, categoriaId, nombre, precioCentavos, controlaStock, umbralBajo, sandwichTipo, activo, lineasReceta, modo, reventa }) {
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

  // "pendiente" y "reventa" ignoran las lineas del formulario: en pendiente no
  // hay receta, y en reventa la receta es la del insumo espejo (se arma aparte,
  // abajo). Ninguna de las dos puede BORRAR una receta que ya existia — si el
  // producto tiene lineas, el modo no aplica y se respeta lo que traiga el
  // formulario, para que cambiar de modo por error nunca tire una receta hecha.
  const yaTieneReceta = recetasActuales.some((r) => r.productoId === productoId);
  const modoEfectivo = yaTieneReceta ? "receta" : (modo || "receta");
  if (modoEfectivo !== "receta") lineasReceta = [];

  const producto = {
    id: productoId,
    categoriaId,
    nombre,
    precioCentavos,
    // Lo que se compra hecho no se produce nunca: no controla stock y no
    // aparece en Produccion. Su stock vive en el insumo (1 por venta).
    controlaStock: modoEfectivo === "reventa" ? false : controlaStock,
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
  const provInsumosNuevos = [];

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
        // Si en el mismo formulario se eligio a quien comprarselo, la linea de
        // proveedor se crea aca y no en otra pantalla. Un insumo sin proveedor
        // no entra nunca en la lista de compras, y hasta ahora habia que
        // acordarse de ir a cargarlo aparte.
        const lineaProv = construirLineaProveedor(l, insumoNuevo, now);
        if (lineaProv) provInsumosNuevos.push(lineaProv);
        return { insumoId: insumoNuevo.id, cantidadPorUnidad: cantidadDecimal(l), variantesCantidad };
      }
      return { insumoId: l.insumoId, cantidadPorUnidad: cantidadDecimal(l), variantesCantidad };
    });

  const recetasDelProducto = recetasActuales.filter(r => r.productoId === productoId);
  const recetaPorId = new Map(recetasDelProducto.map(r => [r.id, r]));
  const idsFinales = new Set(lineasFinales.map(l => `${productoId}:${l.insumoId}`));

  await withStores(["productos", "insumos", "recetas", "proveedor_insumos"], "readwrite", (stores) => {
    stores.productos.put(producto);
    for (const insumo of insumosNuevos) stores.insumos.put(insumo);
    for (const linea of provInsumosNuevos) stores.proveedor_insumos.put(linea);
    // Solo se borran las lineas que el usuario saco del formulario. Antes se
    // borraban TODAS y se recreaban de cero, y eso se llevaba puesto los
    // campos que esta pantalla no maneja — sobre todo recetaFija, la marca
    // que dice "esta receta es exacta, no la aprendas" (la miga: siempre 0,5
    // rebanadas, ver CLAUDE.md 9). Resultado: tocar el precio de un sandwich
    // aca desactivaba en silencio la receta fija de su miga y la metia en el
    // modelo de calibracion. Ahora cada linea se FUSIONA con la que ya
    // existia y solo se pisa lo que este formulario realmente edita.
    for (const receta of recetasDelProducto) {
      if (!idsFinales.has(receta.id)) stores.recetas.delete(receta.id);
    }
    for (const linea of lineasFinales) {
      const id = `${productoId}:${linea.insumoId}`;
      const existente = recetaPorId.get(id);
      const cantidadCambio = !existente || existente.cantidadPorUnidad !== linea.cantidadPorUnidad;
      stores.recetas.put({
        ...(existente || {}),
        id,
        productoId,
        insumoId: linea.insumoId,
        cantidadPorUnidad: linea.cantidadPorUnidad,
        ...(Object.keys(linea.variantesCantidad || {}).length
          ? { variantesCantidad: linea.variantesCantidad }
          : existente ? { variantesCantidad: undefined } : {}),
        // Una cantidad escrita a mano deja de ser estimacion (mismo criterio
        // que actualizarReceta en aprovisionamiento.js). Si no se toco, se
        // respeta lo que ya decia.
        esEstimado: cantidadCambio ? !existente : existente.esEstimado === true,
        creadoEn: existente?.creadoEn || now,
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
  if (insumosNuevos.length > 0) await trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  // DESPUES de los insumos, nunca antes: proveedor_insumos los referencia por
  // clave foranea y Supabase rechaza el lote entero con un 409 si el insumo
  // todavia no llego (paso con el modulo de proveedores, y el badge de la cola
  // quedaba en rojo sin que nada en pantalla explicara por que).
  if (provInsumosNuevos.length > 0) {
    trySyncProveedorInsumosSnapshot(await getAll("proveedor_insumos")).catch(() => {});
  }

  // Se compra hecho: ahora que el producto existe, se arma su insumo espejo.
  // Va despues y por separado porque la receta referencia al producto por
  // clave foranea, y el snapshot del catalogo ya quedo en la cola de arriba.
  if (modoEfectivo === "reventa") {
    await definirProductoComoReventa({ productoId, datos: reventa || {} });
  }

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

  // Se lee ANTES de abrir la transaccion: adentro no se puede await nada que
  // no sea requestToPromise sobre la propia transaccion (CLAUDE.md 8.1).
  const pendienteCatalogo = hayPendientesDeTipo("catalogo_snapshot");
  let podados = [];

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

    // Y lo que este pull NO hacia hasta ahora: borrar de la copia local los
    // productos que ya no estan en la nube. Un pull que solo hace put() es,
    // igual que un snapshot, un upsert — nunca saca nada. Resultado: un
    // producto eliminado desde otro dispositivo seguia apareciendo en el Menu
    // y en Caja de este para siempre, y encima su snapshot de arranque lo
    // reinsertaba en Supabase (lo revivia para todos).
    //
    // Dos guardas antes de borrar nada, porque esto es destructivo:
    //  - una respuesta vacia no habilita a vaciar el catalogo local (seria un
    //    error de red leido como "el dueño borro todo");
    //  - si hay un snapshot de catalogo sin subir, este dispositivo puede
    //    tener un producto que la nube todavia no vio (creado sin internet):
    //    podarlo lo perderia. Se saltea y se poda en el proximo pull.
    if (productosRemotos.length > 0 && !pendienteCatalogo) {
      const idsRemotos = new Set(productosRemotos.map((p) => p.id));
      const productosLocales = await requestToPromise(stores.productos.getAll());
      const aBorrar = new Set(productosLocales.filter((p) => !idsRemotos.has(p.id)).map((p) => p.id));
      podados = [...aBorrar];
      for (const id of aBorrar) stores.productos.delete(id);
      // Las recetas del producto podado se van con el: una receta huerfana
      // (apuntando a un producto que no existe) hace fallar el push del lote
      // ENTERO de recetas por la FK, o sea deja de sincronizar todas.
      const recetasLocales = await requestToPromise(stores.recetas.getAll());
      for (const r of recetasLocales) {
        if (aBorrar.has(r.productoId)) stores.recetas.delete(r.id);
      }
    }
  });

  return {
    categorias: categoriasRemotas.length,
    productos: productosRemotos.length,
    recetas: recetasRemotas.length,
    podados
  };
}

// ---------------------------------------------------------------------------
// Eliminar un producto — DEFINITIVO, sin papelera
// ---------------------------------------------------------------------------
//
// Lo que pidio el dueño: "borrara el producto, y si lo quiere volver a tener
// debe crearlo de nuevo, con su receta y asignacion de insumos". No hay
// soft-delete: para eso ya esta "Mostrar en caja" (setProductoActivo).
//
// Pero hay un limite duro que NO es negociable: los registros financieros son
// append-only y auditables (viene la conexion con Hacienda, ver CLAUDE.md).
// Una venta ya cargada nombra a su producto, y el dashboard reconstruye
// facturacion y produccion leyendo detalle_venta / movimientos_stock. Ademas
// el schema de Supabase tiene FK sin cascada desde movimientos_stock,
// movimientos_insumos y detalle_pedido hacia productos(id): el DELETE remoto
// fallaria con 23503 y el producto reviviria en el proximo "Actualizar
// catalogo". Asi que un producto con historial NO se borra: se oculta, y se
// dice por que.

// Se pregunta a la nube, no a la IDB local: los pedidos solo existen en
// Supabase, y las ventas cargadas en OTRO dispositivo no estan en la copia
// local de este. Sin conexion no se puede responder, y adivinar aca seria
// borrar un producto que quiza tiene ventas en otro lado — asi que se corta.
// Esta pantalla es Gestion, no la caja: esperar la red aca esta permitido (lo
// que nunca puede esperar a la nube es confirmar una venta).
export async function verificarEliminacionProducto(id) {
  const producto = await getOne("productos", id);
  if (!producto) throw new Error("Producto no encontrado.");

  let referencias;
  try {
    referencias = await contarReferenciasProducto(id);
  } catch (error) {
    throw new Error(
      "Para eliminar hace falta conexion: hay que revisar en la nube si el producto tiene ventas o pedidos. Proba cuando vuelva el wifi."
    );
  }

  const bloqueos = clasificarBloqueosEliminacion(referencias);

  const recetas = (await getAll("recetas")).filter((r) => r.productoId === id);

  return {
    producto,
    nombre: producto.nombre,
    puede: bloqueos.length === 0,
    bloqueos,
    referencias,
    lineasReceta: recetas.length,
    stockActual: Number(producto.stockActual) || 0
  };
}

// Borra el producto y SUS LINEAS DE RECETA en la misma transaccion. Separarlo
// en dos pasos dejaba, si el segundo fallaba, una receta huerfana apuntando a
// un producto inexistente — y eso hace fallar el push del snapshot ENTERO de
// recetas (FK recetas.producto_id), o sea: deja de sincronizar TODAS las
// recetas, no solo la de este producto.
export async function eliminarProducto(id) {
  const verificacion = await verificarEliminacionProducto(id);
  if (!verificacion.puede) {
    const error = new Error(mensajeBloqueoEliminacion(verificacion));
    error.bloqueado = true;
    error.verificacion = verificacion;
    throw error;
  }

  const recetasDelProducto = (await getAll("recetas")).filter((r) => r.productoId === id);
  const idsReceta = new Set(recetasDelProducto.map((r) => r.id));
  const historial = (await getAll("historial_recetas")).filter(
    (h) => h.productoId === id || idsReceta.has(h.recetaId)
  );

  // LA NUBE PRIMERO, y recien despues lo local. Al reves (lo que parecia
  // natural: borrar local y dejar que la cola se encargue) el fallo es el peor
  // posible: el producto desaparece de la tablet, el borrado remoto no entra,
  // y el proximo "Actualizar catalogo" lo vuelve a bajar como si nada. El
  // usuario ve un producto resucitar sin explicacion.
  // Asi, si la nube no deja borrar, no se borro nada en ningun lado y el
  // mensaje de error lo dice. Esta accion ya necesita conexion de todas formas
  // (verificarEliminacionProducto pregunta por los pedidos, que viven solo en
  // Supabase), asi que no se pierde nada por exigirla. Nada de esto esta en el
  // camino de confirmar una venta — eso sigue sin esperar a la nube nunca.
  await deleteProductoRemoto(id);

  // Si el producto estaba asignado a un grupo de variante (ej. "Tipo de
  // leche"), sacarlo de ahi: el grupo guarda una lista de productoIds y
  // quedaria apuntando a un producto que ya no existe.
  await setProductoGrupoVariante(id, null);

  await withStores(["productos", "recetas", "historial_recetas"], "readwrite", (stores) => {
    for (const receta of recetasDelProducto) stores.recetas.delete(receta.id);
    for (const h of historial) stores.historial_recetas.delete(h.id);
    stores.productos.delete(id);
  });

  const [categorias, productosFinal, recetasFinal] = await Promise.all([
    getAll("categorias"),
    getAll("productos"),
    getAll("recetas")
  ]);
  // Los snapshots ya no contienen el producto, asi que solo alinean al resto.
  // El borrado remoto se vuelve a encolar DESPUES de ellos a proposito: si en
  // la cola quedaba un snapshot viejo de antes del borrado, ese snapshot
  // todavia incluye el producto y lo reinserta (un snapshot es un upsert: no
  // borra nada). Encolado ultimo, y como el drenado respeta el orden, el
  // borrado tiene siempre la ultima palabra. Es idempotente, repetirlo no
  // cuesta nada.
  trySyncCatalogoSnapshot(categorias, productosFinal).catch(() => {});
  trySyncRecetasSnapshot(recetasFinal).catch(() => {});
  trySyncProductoEliminado(id).catch(() => {});

  return { nombre: verificacion.producto.nombre, lineasReceta: recetasDelProducto.length };
}

export async function setProductoActivo(id, activo) {
  const producto = await getOne("productos", id);
  if (!producto) throw new Error("Producto no encontrado.");
  await putOne("productos", { ...producto, activo, actualizadoEn: new Date().toISOString() });
  const [categorias, productos] = await Promise.all([getAll("categorias"), getAll("productos")]);
  trySyncCatalogoSnapshot(categorias, productos).catch(() => {});
}

// Guarda de una sola vez el orden completo de una categoria — lo que hace
// falta al reordenar arrastrando (moverProductoOrden, mas abajo, mueve de a
// un lugar y sirve para los botones de flecha).
export async function reordenarProductos(categoriaId, idsEnOrden) {
  const productos = await getAll("productos");
  const delaCategoria = productos.filter((p) => p.categoriaId === categoriaId);
  const porId = new Map(delaCategoria.map((p) => [p.id, p]));
  // Solo se acepta un orden que contenga exactamente los mismos productos que
  // la categoria: si llegara una lista incompleta (ej. una pantalla vieja),
  // reordenar con ella dejaria productos sueltos al final sin que se note.
  if (idsEnOrden.length !== delaCategoria.length || idsEnOrden.some((id) => !porId.has(id))) {
    throw new Error("El orden recibido no coincide con los productos de la categoria.");
  }

  const now = new Date().toISOString();
  await withStores(["productos"], "readwrite", (stores) => {
    idsEnOrden.forEach((id, indice) => {
      stores.productos.put({ ...porId.get(id), orden: indice + 1, actualizadoEn: now });
    });
  });

  const [categorias, productosFinal] = await Promise.all([getAll("categorias"), getAll("productos")]);
  trySyncCatalogoSnapshot(categorias, productosFinal).catch(() => {});
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
