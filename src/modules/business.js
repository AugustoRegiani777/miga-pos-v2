import { getAll, getOne, requestToPromise, withStores } from "../db/idb.js";
import { currentTime, todayISO } from "../utils/format.js";
import { calculateCartPricing } from "./pricing.js";
import { deductInsumosForProductionInTx, deductInsumosInTx, restoreInsumosInTx } from "./aprovisionamiento.js";
import { fetchMovimientosStockCatalogo, fetchStockProductos, fetchVentasDelDia, fetchMovimientosStockDesde, fetchConfiguracionCompartida } from "../db/supabase.js";
import { trySyncConfiguracionCompartida } from "./sync.js";

const PRODUCTION_CATEGORIES = new Set(["sandwiches", "bolleria", "bebidas"]);
export const TOGOO_FLAT_TOTAL_CENTAVOS = 300;
const DECREASE_ONLY_MOTIVOS = new Set(["Consumo"]);
const productionCommentKey = (fecha) => `production-comment:${fecha}`;

function normalizeProductionComments(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }
  const singleComment = String(rawValue || "").trim();
  return singleComment ? [singleComment] : [];
}

function asNonNegativeInteger(value, fieldName) {
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`${fieldName} debe ser un numero entero no negativo.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${fieldName} debe ser un numero entero no negativo.`);
  }
  return parsed;
}

function asInteger(value, fieldName) {
  const raw = String(value).trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${fieldName} debe ser un numero entero.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${fieldName} debe ser un numero entero.`);
  }
  return parsed;
}

function groupCartItems(items) {
  const lines = new Map();
  const stockByProduct = new Map();
  for (const item of items) {
    const quantity = asNonNegativeInteger(item.quantity, "La cantidad");
    if (!item.productId || quantity <= 0) throw new Error("El carrito tiene cantidades invalidas.");
    const saleMode = item.saleMode === "togoo" || item.saleMode === "baja" ? item.saleMode : "normal";
    const opcionNombre = item.opcionNombre || null;
    const lineKey = `${item.productId}:${saleMode}:${opcionNombre || ""}`;
    const currentLine = lines.get(lineKey) || { productId: item.productId, quantity: 0, saleMode, opcionNombre, unitOrders: [] };
    currentLine.quantity += quantity;
    currentLine.unitOrders.push(...(Array.isArray(item.unitOrders) ? item.unitOrders.slice(0, quantity) : []));
    lines.set(lineKey, currentLine);
    stockByProduct.set(item.productId, (stockByProduct.get(item.productId) || 0) + quantity);
  }
  if (lines.size === 0) throw new Error("El carrito esta vacio.");
  return {
    lines: Array.from(lines.values()),
    stockItems: Array.from(stockByProduct, ([productId, quantity]) => ({ productId, quantity }))
  };
}

export async function listCategories() {
  const categories = await getAll("categorias");
  return categories.sort((a, b) => a.orden - b.orden);
}

export async function listProducts() {
  const [categories, products] = await Promise.all([listCategories(), getAll("productos")]);
  const categoriesById = new Map(categories.map((category) => [category.id, category]));
  return products
    .filter((product) => product.activo)
    .map((product) => ({
      ...product,
      categoria: categoriesById.get(product.categoriaId)?.nombre || product.categoriaId
    }))
    .sort((a, b) => {
      const catDiff = (categoriesById.get(a.categoriaId)?.orden || 0) - (categoriesById.get(b.categoriaId)?.orden || 0);
      return catDiff || a.orden - b.orden || a.nombre.localeCompare(b.nombre);
    });
}

export async function productionSnapshot(fecha = todayISO()) {
  const products = await listProducts();
  const productionComments = await withStores(["configuracion"], "readonly", async (stores) => {
    const row = await requestToPromise(stores.configuracion.get(productionCommentKey(fecha)));
    return normalizeProductionComments(row?.valor);
  });
  const movimientosStockHoy = (await getAll("movimientos_stock")).filter((row) => row.fecha === fecha);
  const productionMovements = movimientosStockHoy
    .filter((row) => row.tipo === "produccion" || row.tipo === "ajuste_manual" || row.tipo === "ajuste_stock")
    .sort((a, b) => String(a.creadoEn || "").localeCompare(String(b.creadoEn || "")));
  // "Producido hoy" se deriva de la MISMA fuente que las lineas de abajo (los
  // propios movimientos_stock tipo "produccion" de hoy) — nunca de un contador
  // aparte (produccion_diaria) que se actualiza por separado y puede
  // desalinearse del historial real (ver incidente del 19/09/2026: un
  // registro fantasma en movimientos_stock hizo que el total mostrado no
  // coincidiera con la suma de sus propias lineas). Con una sola fuente, eso
  // ya no puede pasar — el total SIEMPRE es la suma de lo que se ve debajo.
  const producedByProduct = new Map();
  for (const movement of movimientosStockHoy) {
    if (movement.tipo !== "produccion") continue;
    const cantidad = Number(movement.cantidad) || 0;
    producedByProduct.set(movement.productoId, (producedByProduct.get(movement.productoId) || 0) + cantidad);
  }
  const movementsByProduct = new Map();
  for (const movement of productionMovements) {
    const list = movementsByProduct.get(movement.productoId) || [];
    list.push({
      tipo: movement.tipo,
      motivo: movement.motivo,
      cantidad: movement.cantidad,
      creadoEn: movement.creadoEn
    });
    movementsByProduct.set(movement.productoId, list);
  }
  // Cuanto se vendio hoy de cada producto, NETO de anulaciones — movimientos_stock
  // tipo "venta" es exactamente eso (lo escribe confirmSale al cerrar cada
  // venta), pero si esa venta se deshace despues (undoSale), no se borra ese
  // movimiento: se agrega uno nuevo tipo "devolucion" que repone el stock. Sin
  // restar ese devolucion, una venta anulada seguiria contando como vendida.
  const soldByProduct = new Map();
  for (const movement of movimientosStockHoy) {
    if (movement.tipo === "venta") {
      const cantidadVendida = Math.abs(Number(movement.cantidad) || 0);
      soldByProduct.set(movement.productoId, (soldByProduct.get(movement.productoId) || 0) + cantidadVendida);
    } else if (movement.tipo === "devolucion") {
      const cantidadDevuelta = Math.abs(Number(movement.cantidad) || 0);
      soldByProduct.set(movement.productoId, (soldByProduct.get(movement.productoId) || 0) - cantidadDevuelta);
    }
  }
  return {
    fecha,
    comentarios: productionComments,
    sandwiches: products
      .filter((product) => product.categoriaId === "sandwiches" && product.controlaStock)
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || [],
        vendidoHoy: soldByProduct.get(product.id) || 0
      })),
    bolleria: products
      .filter((product) => product.categoriaId === "bolleria")
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || [],
        vendidoHoy: soldByProduct.get(product.id) || 0
      })),
    bebidas: products
      .filter((product) => product.categoriaId === "bebidas")
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || [],
        vendidoHoy: soldByProduct.get(product.id) || 0
      })),
    productionProducts: products
      .filter((product) => PRODUCTION_CATEGORIES.has(product.categoriaId) && product.controlaStock)
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || [],
        vendidoHoy: soldByProduct.get(product.id) || 0
      }))
  };
}

export async function saveProductionComment(comment, fecha = todayISO()) {
  const comentario = String(comment || "").trim();
  if (!comentario) {
    throw new Error("Escribe un comentario antes de guardar.");
  }
  const now = new Date().toISOString();
  const comentarios = await withStores(["configuracion"], "readwrite", async (stores) => {
    const currentRow = await requestToPromise(stores.configuracion.get(productionCommentKey(fecha)));
    const comentariosActualizados = normalizeProductionComments(currentRow?.valor);
    comentariosActualizados.push(comentario);
    stores.configuracion.put({
      id: productionCommentKey(fecha),
      valor: comentariosActualizados,
      actualizadoEn: now
    });
    return comentariosActualizados;
  });
  // Antes esto quedaba SOLO en la tablet — si se rompia, se perdian los
  // comentarios del dia para siempre. Reusa configuracion_compartida (misma
  // tabla que ya usan los grupos de variante) con el mismo id que la fila
  // local, asi no hace falta una tabla nueva para esto.
  trySyncConfiguracionCompartida(productionCommentKey(fecha), comentarios).catch(() => {});
}

export async function stockSnapshot(fecha = todayISO()) {
  const products = await listProducts();
  const stockMovements = (await getAll("movimientos_stock")).filter((row) => row.fecha === fecha);
  const producedByProduct = new Map();
  const soldByProduct = new Map();

  for (const movement of stockMovements) {
    if (movement.tipo === "produccion" || movement.tipo === "ajuste_manual") {
      producedByProduct.set(
        movement.productoId,
        (producedByProduct.get(movement.productoId) || 0) + (Number(movement.cantidad) || 0)
      );
    }
    if (movement.tipo === "venta") {
      soldByProduct.set(
        movement.productoId,
        (soldByProduct.get(movement.productoId) || 0) + Math.abs(Number(movement.cantidad) || 0)
      );
    }
  }

  return products
    .filter((product) => product.controlaStock)
    .map((product) => ({
      ...product,
      cantidadProducida: producedByProduct.get(product.id) || 0,
      cantidadVendida: soldByProduct.get(product.id) || 0
    }));
}

// productos.stockActual es un valor EN VIVO (se pisa constantemente), no un
// historial por dia. Para saber cuanto stock habia en una fecha pasada hay
// que reconstruirlo: partir del stock de hoy y deshacer los movimientos
// posteriores a esa fecha. movimientos_stock guarda cada cambio con signo
// (cantidad ya incluye el +/-), asi que es una resta directa.
export async function stockHistoricoPorFecha(fecha) {
  const [productos, movimientos] = await Promise.all([getAll("productos"), getAll("movimientos_stock")]);

  const sumaPorProducto = (lista) => {
    const map = new Map();
    for (const movimiento of lista) {
      map.set(
        movimiento.productoId,
        (map.get(movimiento.productoId) || 0) + (Number(movimiento.cantidad) || 0)
      );
    }
    return map;
  };

  const sumaPosterior = sumaPorProducto(movimientos.filter((m) => m.fecha > fecha));
  const movimientosDelDia = movimientos.filter((m) => m.fecha === fecha);
  const sumaDelDia = sumaPorProducto(movimientosDelDia);
  // Ajustes del dia (recuento, consumo, cierre de periodo, altas/bajas
  // manuales) — aparte de produccion/venta/devolucion, para que el resumen de
  // Historial ("De ayer + Producido - Vendido + Ajustes = Quedan") pueda
  // mostrar ese numero en vez de dejarlo escondido dentro de "Quedan" nada
  // mas. Sin esto, un recuento de stock hace que la cuenta simple del usuario
  // (ayer + producido - vendido) no cierre con lo que ve en pantalla, sin
  // ninguna pista de por que.
  //
  // "Error de produccion" queda AFUERA de "ajuste" a proposito y se cuenta
  // aparte (erroresProduccion): no es un movimiento fisico de stock como un
  // recuento o una merma, es la correccion de un numero de produccion mal
  // cargado — mezclarlo con los ajustes reales confunde cuanto stock se movio
  // de verdad por causas externas.
  const esErrorDeProduccion = (m) => m.tipo === "ajuste_stock" && (m.motivo === "Error de produccion" || m.motivo === "Error");
  const sumaAjustesDelDia = sumaPorProducto(
    movimientosDelDia.filter((m) => (m.tipo === "ajuste_manual" || m.tipo === "ajuste_stock") && !esErrorDeProduccion(m))
  );
  const sumaErroresDelDia = sumaPorProducto(movimientosDelDia.filter(esErrorDeProduccion));

  const resultado = new Map();
  for (const producto of productos) {
    const stockHoy = Number(producto.stockActual) || 0;
    const stockAlFinal = stockHoy - (sumaPosterior.get(producto.id) || 0);
    const stockAlInicio = stockAlFinal - (sumaDelDia.get(producto.id) || 0);
    const ajuste = sumaAjustesDelDia.get(producto.id) || 0;
    const erroresProduccion = sumaErroresDelDia.get(producto.id) || 0;
    resultado.set(producto.id, { stockAlInicio, stockAlFinal, ajuste, erroresProduccion });
  }
  return resultado;
}

const CURSOR_MOVIMIENTOS_STOCK = "cursor_movimientos_stock_nube";

// Fusiona el stock de PRODUCTOS (sandwiches/bolleria) entre dispositivos por
// DELTAS — mismo mecanismo exacto que sincronizarStockInsumosDesdeMovimientos
// en aprovisionamiento.js, aplicado aca porque stockActual de un producto es
// igual de derivado: parte de un valor base y se mueve solo a traves de
// movimientos_stock (venta, produccion, ajuste_stock, devolucion — ver
// confirmSale, undoSale, saveDailyProduction, adjustStockLevel).
//
// Hoy solo vende/produce una tablet, asi que esto no tiene nada que fusionar
// en la practica (todo se genera en un solo lugar). Queda andando para el
// dia que eso cambie: si dos dispositivos alguna vez tocaran el stock del
// mismo producto, la suma de deltas da lo mismo sin importar el orden en que
// lleguen — a diferencia de traer "el numero final" y pisar, que es
// exactamente la falla de fondo que causo los incidentes del 13/15/19 de
// septiembre en produccion_diaria (ver migracion 010).
//
// Idempotente por uuid, igual que el resto del sync (CLAUDE.md 8.7): un
// movimiento ya aplicado localmente nunca se vuelve a sumar. El cursor por
// fecha es pura optimizacion; el filtro por uuid es lo que garantiza
// correctitud aunque el cursor fallara.
export async function sincronizarStockProductosDesdeMovimientos() {
  const cursor = await getOne("configuracion", CURSOR_MOVIMIENTOS_STOCK);
  const desde = cursor?.valor || null;

  const [remotos, locales] = await Promise.all([
    fetchMovimientosStockCatalogo(desde),
    getAll("movimientos_stock")
  ]);

  const uuidsLocales = new Set(locales.map((m) => m.uuid).filter(Boolean));
  const nuevos = remotos.filter((r) => r.uuid && !uuidsLocales.has(r.uuid));
  if (nuevos.length === 0) return { aplicados: 0, productosActualizados: 0 };

  const deltaPorProducto = new Map();
  for (const r of nuevos) {
    if (!r.producto_id) continue;
    const delta = Number(r.cantidad) || 0;
    deltaPorProducto.set(r.producto_id, (deltaPorProducto.get(r.producto_id) || 0) + delta);
  }

  const now = new Date().toISOString();
  let maxFecha = desde || "";
  for (const r of nuevos) {
    if (r.creado_en && r.creado_en > maxFecha) maxFecha = r.creado_en;
  }

  // El stockActual base se lee ACA DENTRO, recien al escribir — no antes, no
  // desde un Map armado mientras se esperaba la red (mismo incidente real del
  // 19/09/2026 en pullCatalogoDesdeNube: leer el local antes de esperar la
  // red y escribir con ese dato ya viejo pisa cualquier venta/produccion que
  // haya pasado mientras tanto en este dispositivo).
  await withStores(["productos", "movimientos_stock", "configuracion"], "readwrite", async (stores) => {
    for (const [productoId, delta] of deltaPorProducto) {
      const producto = await requestToPromise(stores.productos.get(productoId));
      if (!producto) continue; // producto nuevo del otro dispositivo: llega con el proximo pullCatalogoDesdeNube
      const stockNuevo = (Number(producto.stockActual) || 0) + delta;
      stores.productos.put({ ...producto, stockActual: stockNuevo, actualizadoEn: now });
    }
    for (const r of nuevos) {
      stores.movimientos_stock.add({
        uuid: r.uuid,
        productoId: r.producto_id,
        tipo: r.tipo,
        cantidad: Number(r.cantidad) || 0,
        stockAnterior: r.stock_anterior,
        stockNuevo: r.stock_nuevo,
        motivo: r.motivo || undefined,
        referencia: r.referencia || undefined,
        fecha: r.fecha,
        creadoEn: r.creado_en
      });
    }
    stores.configuracion.put({ id: CURSOR_MOVIMIENTOS_STOCK, valor: maxFecha, actualizadoEn: now });
  });

  return { aplicados: nuevos.length, productosActualizados: deltaPorProducto.size };
}

// Version remota de stockHistoricoPorFecha() — misma logica, pero sobre
// movimientos_stock traidos de Supabase en vez de locales (para "modo
// consulta" y para datosRemotosDelDia, mas abajo). Antes vivia duplicada
// (con una version mas vieja, sin separar "Error de produccion") en app.js;
// unificada aca para que ambos usos compartan exactamente la misma logica.
export function historicoDesdeMovimientosRemotos(catalogo, movimientosDesde, fecha) {
  const sumaPorProducto = (lista) => {
    const map = new Map();
    for (const m of lista) {
      map.set(m.producto_id, (map.get(m.producto_id) || 0) + (Number(m.cantidad) || 0));
    }
    return map;
  };
  const sumaPosterior = sumaPorProducto(movimientosDesde.filter((m) => m.fecha > fecha));
  const movimientosDelDia = movimientosDesde.filter((m) => m.fecha === fecha);
  const sumaDelDia = sumaPorProducto(movimientosDelDia);
  const esErrorDeProduccion = (m) => m.tipo === "ajuste_stock" && (m.motivo === "Error de produccion" || m.motivo === "Error");
  const sumaAjustesDelDia = sumaPorProducto(
    movimientosDelDia.filter((m) => (m.tipo === "ajuste_manual" || m.tipo === "ajuste_stock") && !esErrorDeProduccion(m))
  );
  const sumaErroresDelDia = sumaPorProducto(movimientosDelDia.filter(esErrorDeProduccion));
  const resultado = new Map();
  for (const producto of catalogo) {
    const stockHoy = Number(producto.stockActual) || 0;
    const stockAlFinal = stockHoy - (sumaPosterior.get(producto.id) || 0);
    const stockAlInicio = stockAlFinal - (sumaDelDia.get(producto.id) || 0);
    const ajuste = sumaAjustesDelDia.get(producto.id) || 0;
    const erroresProduccion = sumaErroresDelDia.get(producto.id) || 0;
    resultado.set(producto.id, { stockAlInicio, stockAlFinal, ajuste, erroresProduccion });
  }
  return resultado;
}

function mapVentaRemota(row) {
  return {
    id: row.id,
    fecha: row.fecha,
    hora: row.hora,
    totalCentavos: row.total_centavos,
    saleMode: row.sale_mode || "normal",
    origen: row.origen,
    pedidoId: row.pedido_id,
    clienteNombre: row.cliente_nombre,
    detalles: (row.detalle_venta || []).map((d) => ({
      id: d.id,
      ventaId: d.venta_id,
      productoId: d.producto_id,
      productoNombre: d.producto_nombre,
      cantidad: d.cantidad,
      precioUnitarioCentavos: d.precio_unitario_centavos,
      subtotalCentavos: d.subtotal_centavos,
      opcionNombre: d.opcion_nombre || null
    }))
  };
}

// Version "cualquier dispositivo" de salesForDay/productionSnapshot/
// stockHistoricoPorFecha juntas — para el exportador de TXT/ZIP (backup.js),
// que hasta ahora solo funcionaba bien desde la tablet que realmente opera:
// si se generaba desde otro dispositivo (el celu, una pestaña vieja), leia
// su base local vacia y entregaba un archivo prolijo pero en cero, sin
// avisar que estaba mirando en el lugar equivocado (incidente real,
// 19/09/2026). Junta en UNA sola pasada de red lo mismo que overia el
// dispositivo que opera, en la MISMA forma exacta (sales/snapshot/historico),
// para que el resto del codigo de backup.js no tenga que saber de donde
// salio. El catalogo (nombre/categoria/controlaStock) se lee local porque
// eso ya es identico en todos los dispositivos via seed + sync de catalogo;
// lo unico que de verdad varia por dispositivo es el stock EN VIVO, y eso
// se trae de Supabase.
export async function datosRemotosDelDia(fecha) {
  const [productosLocales, stockRemoto, ventasRemotas, movimientosDesde, comentarioRow] = await Promise.all([
    listProducts(),
    fetchStockProductos(),
    fetchVentasDelDia(fecha),
    fetchMovimientosStockDesde(fecha),
    fetchConfiguracionCompartida(productionCommentKey(fecha)).catch(() => null)
  ]);

  const stockById = new Map(stockRemoto.map((row) => [row.id, Number(row.stock_actual)]));
  const productos = productosLocales.map((p) => ({
    ...p,
    stockActual: stockById.has(p.id) ? stockById.get(p.id) : p.stockActual
  }));

  const sales = ventasRemotas.map(mapVentaRemota);

  const movimientosDelDia = movimientosDesde.filter((m) => m.fecha === fecha);
  const producedByProduct = new Map();
  const soldByProduct = new Map();
  const movementsByProduct = new Map();
  for (const m of movimientosDelDia) {
    if (m.tipo === "produccion") {
      producedByProduct.set(m.producto_id, (producedByProduct.get(m.producto_id) || 0) + (Number(m.cantidad) || 0));
    }
    if (m.tipo === "venta") {
      soldByProduct.set(m.producto_id, (soldByProduct.get(m.producto_id) || 0) + Math.abs(Number(m.cantidad) || 0));
    } else if (m.tipo === "devolucion") {
      soldByProduct.set(m.producto_id, (soldByProduct.get(m.producto_id) || 0) - Math.abs(Number(m.cantidad) || 0));
    }
    if (m.tipo === "produccion" || m.tipo === "ajuste_manual" || m.tipo === "ajuste_stock") {
      const list = movementsByProduct.get(m.producto_id) || [];
      list.push({ tipo: m.tipo, motivo: m.motivo, cantidad: m.cantidad, creadoEn: m.creado_en });
      movementsByProduct.set(m.producto_id, list);
    }
  }

  const conDatos = (product) => ({
    ...product,
    cantidadProducida: producedByProduct.get(product.id) || 0,
    movimientosProduccion: movementsByProduct.get(product.id) || [],
    vendidoHoy: soldByProduct.get(product.id) || 0
  });

  const comentarios = normalizeProductionComments(comentarioRow?.valor);

  const snapshot = {
    fecha,
    comentarios,
    sandwiches: productos.filter((p) => p.categoriaId === "sandwiches" && p.controlaStock).map(conDatos),
    bolleria: productos.filter((p) => p.categoriaId === "bolleria").map(conDatos),
    bebidas: productos.filter((p) => p.categoriaId === "bebidas").map(conDatos),
    productionProducts: productos.filter((p) => PRODUCTION_CATEGORIES.has(p.categoriaId) && p.controlaStock).map(conDatos)
  };

  const historico = historicoDesdeMovimientosRemotos(productos, movimientosDesde, fecha);

  return { sales, products: productos, snapshot, historico, movimientosDelDia };
}

export async function adjustStockLevel(productId, newStockValue, reason, fecha = todayISO()) {
  const nuevoStock = asNonNegativeInteger(newStockValue, "El nuevo stock");
  const motivo = String(reason || "").trim();
  if (!motivo) {
    throw new Error("Selecciona un motivo para el ajuste.");
  }
  const now = new Date().toISOString();

  return withStores(["productos", "movimientos_stock", "produccion_diaria", "insumos", "recetas", "movimientos_insumos"], "readwrite", async (stores) => {
    const product = await requestToPromise(stores.productos.get(productId));
    if (!product || !product.controlaStock) {
      throw new Error("Producto invalido para ajuste de stock.");
    }

    const stockAnterior = Number(product.stockActual) || 0;
    const cantidad = nuevoStock - stockAnterior;
    if (cantidad === 0) {
      throw new Error("No hay cambios para guardar en el stock.");
    }
    if (DECREASE_ONLY_MOTIVOS.has(motivo) && nuevoStock > stockAnterior) {
      throw new Error(`"${motivo}" solo puede reducir el stock. Stock actual: ${stockAnterior}.`);
    }

    let warnings = [];
    let movimientosInsumos = [];
    if ((motivo === "Error de produccion" || motivo === "Error") && PRODUCTION_CATEGORIES.has(product.categoriaId)) {
      const productionId = `${fecha}:${productId}`;
      const currentProduction = await requestToPromise(stores.produccion_diaria.get(productionId));
      const produccionAnterior = Number(currentProduction?.cantidad) || 0;
      const produccionNueva = produccionAnterior + cantidad;
      if (produccionNueva < 0) {
        throw new Error(`No se puede dejar la produccion del dia de ${product.nombre} por debajo de 0.`);
      }
      stores.produccion_diaria.put({
        id: productionId,
        productoId: productId,
        fecha,
        cantidad: produccionNueva,
        creadoEn: currentProduction?.creadoEn || now,
        actualizadoEn: now
      });
      ({ warnings, movimientos: movimientosInsumos } = await deductInsumosForProductionInTx(stores, productId, cantidad, fecha, now));
    }

    stores.productos.put({ ...product, stockActual: nuevoStock, actualizadoEn: now });
    const movimiento = {
      uuid: crypto.randomUUID(),
      productoId: productId,
      tipo: "ajuste_stock",
      cantidad,
      stockAnterior,
      stockNuevo: nuevoStock,
      referencia: `Ajuste stock: ${motivo}`,
      motivo,
      fecha,
      creadoEn: now
    };
    stores.movimientos_stock.add(movimiento);

    return { warnings, movimiento, movimientosInsumos };
  });
}

export async function saveDailyProduction(productId, quantity, fecha = todayISO()) {
  const cantidad = asInteger(quantity, "La produccion");
  if (cantidad === 0) {
    throw new Error("La produccion no puede ser 0.");
  }
  const now = new Date().toISOString();

  return withStores(["productos", "produccion_diaria", "movimientos_stock", "insumos", "recetas", "movimientos_insumos"], "readwrite", async (stores) => {
    const product = await requestToPromise(stores.productos.get(productId));
    if (!product || !PRODUCTION_CATEGORIES.has(product.categoriaId) || !product.controlaStock) {
      throw new Error("Producto invalido para produccion.");
    }

    const stockAnterior = Number(product.stockActual) || 0;
    const stockNuevo = stockAnterior + cantidad;
    if (stockNuevo < 0) {
      throw new Error(`No se puede descontar ${Math.abs(cantidad)} de ${product.nombre}. Stock actual: ${stockAnterior}.`);
    }
    const currentProduction = await requestToPromise(stores.produccion_diaria.get(`${fecha}:${productId}`));
    const productionRow = {
      id: `${fecha}:${productId}`,
      productoId: productId,
      fecha,
      cantidad: (currentProduction?.cantidad || 0) + cantidad,
      creadoEn: currentProduction?.creadoEn || now,
      actualizadoEn: now
    };

    stores.produccion_diaria.put(productionRow);
    stores.productos.put({ ...product, stockActual: stockNuevo, actualizadoEn: now });
    const movimiento = {
      uuid: crypto.randomUUID(),
      productoId: productId,
      tipo: "produccion",
      cantidad,
      stockAnterior,
      stockNuevo,
      referencia: `Produccion ${fecha}`,
      fecha,
      creadoEn: now
    };
    stores.movimientos_stock.add(movimiento);
    const { warnings, movimientos: movimientosInsumos } = await deductInsumosForProductionInTx(stores, productId, cantidad, fecha, now);
    return { warnings, movimiento, movimientosInsumos };
  });
}

export async function confirmSale(items) {
  const cart = groupCartItems(items);
  const fecha = todayISO();
  const hora = currentTime();
  const now = new Date().toISOString();

  return withStores(["productos", "ventas", "detalle_venta", "movimientos_stock", "insumos", "movimientos_insumos", "recetas", "configuracion"], "readwrite", async (stores) => {
    const lines = [];
    let totalCentavos = 0;
    let saleMode = "normal";
    const _detallesSync = [];
    const _movStockSync = [];

    const stockProducts = new Map();
    for (const item of cart.stockItems) {
      const product = await requestToPromise(stores.productos.get(item.productId));
      if (!product || !product.activo) throw new Error("Hay productos invalidos en la venta.");
      if (product.controlaStock && product.stockActual < item.quantity) {
        throw new Error(`Stock insuficiente: ${product.nombre}.`);
      }
      stockProducts.set(product.id, product);
    }

    for (const item of cart.lines) {
      const product = stockProducts.get(item.productId);
      const lineSaleMode = item.saleMode === "togoo" && product.controlaStock
        ? "togoo"
        : item.saleMode === "baja" && product.controlaStock
          ? "baja"
          : "normal";
      if (saleMode === "normal" && lineSaleMode !== "normal") saleMode = lineSaleMode;
      const unitPrice = lineSaleMode === "togoo" || lineSaleMode === "baja"
        ? 0
        : product.precioCentavos;
      const subtotalCentavos = unitPrice * item.quantity;
      totalCentavos += subtotalCentavos;
      const nombreConModo = lineSaleMode === "togoo" ? `${product.nombre} ToGoo` : lineSaleMode === "baja" ? `${product.nombre} BAJA` : product.nombre;
      lines.push({
        product,
        quantity: item.quantity,
        saleMode: lineSaleMode,
        productName: item.opcionNombre ? `${nombreConModo} (${item.opcionNombre})` : nombreConModo,
        opcionNombre: item.opcionNombre || null,
        unitPrice,
        subtotalCentavos,
        unitOrders: item.unitOrders
      });
    }

    const pricing = calculateCartPricing(
      lines
        .filter((line) => line.saleMode === "normal")
        .map((line) => ({
          ...line.product,
          precioCentavos: line.unitPrice,
          quantity: line.quantity,
          unitOrders: line.unitOrders
        }))
    );
    const hasTogoo = lines.some((line) => line.saleMode === "togoo");
    const toGooTotalCentavos = hasTogoo ? TOGOO_FLAT_TOTAL_CENTAVOS : 0;
    const bajaTotalCentavos = lines
      .filter((line) => line.saleMode === "baja")
      .reduce((total, line) => total + line.subtotalCentavos, 0);
    const discountCentavos = pricing.discountCentavos;
    totalCentavos = pricing.totalCentavos + toGooTotalCentavos + bajaTotalCentavos;

    const ventaUuid = crypto.randomUUID();
    const saleId = await requestToPromise(stores.ventas.add({ fecha, hora, totalCentavos, saleMode, creadoEn: now, uuid: ventaUuid }));

    for (const line of lines) {
      const detalle = {
        uuid: crypto.randomUUID(),
        ventaId: saleId,
        productoId: line.product.id,
        productoNombre: line.productName,
        opcionNombre: line.opcionNombre,
        cantidad: line.quantity,
        precioUnitarioCentavos: line.unitPrice,
        subtotalCentavos: line.subtotalCentavos,
        fecha,
        creadoEn: now
      };
      stores.detalle_venta.add(detalle);
      _detallesSync.push(detalle);
    }

    if (discountCentavos > 0) {
      const descuento = {
        uuid: crypto.randomUUID(),
        ventaId: saleId,
        productoId: `combo-${pricing.combo.cantidad}`,
        productoNombre: `Descuento ${pricing.combo.nombre}`,
        cantidad: 1,
        precioUnitarioCentavos: -discountCentavos,
        subtotalCentavos: -discountCentavos,
        fecha,
        creadoEn: now
      };
      stores.detalle_venta.add(descuento);
      _detallesSync.push(descuento);
    }

    if (hasTogoo) {
      const tarifaTogoo = {
        uuid: crypto.randomUUID(),
        ventaId: saleId,
        productoId: "togoo-fee",
        productoNombre: "Tarifa ToGoo",
        cantidad: 1,
        precioUnitarioCentavos: TOGOO_FLAT_TOTAL_CENTAVOS,
        subtotalCentavos: TOGOO_FLAT_TOTAL_CENTAVOS,
        fecha,
        creadoEn: now
      };
      stores.detalle_venta.add(tarifaTogoo);
      _detallesSync.push(tarifaTogoo);
    }

    for (const item of cart.stockItems) {
      const product = stockProducts.get(item.productId);
      if (product.controlaStock) {
        const stockAnterior = product.stockActual;
        const stockNuevo = stockAnterior - item.quantity;
        stores.productos.put({ ...product, stockActual: stockNuevo, actualizadoEn: now });
        const mov = {
          uuid: crypto.randomUUID(),
          productoId: product.id,
          tipo: "venta",
          cantidad: -item.quantity,
          stockAnterior,
          stockNuevo,
          referencia: `Venta #${saleId}`,
          fecha,
          creadoEn: now
        };
        stores.movimientos_stock.add(mov);
        _movStockSync.push(mov);
      }
    }

    // Productos que no controlan stock (cafe, bebidas) no pasan por
    // produccion diaria — para esos, el insumo se descuenta aca, en el
    // momento de la venta, respetando la variante elegida (ver
    // resolverLineaEfectiva en aprovisionamiento.js para el caso de la leche).
    const itemsParaInsumos = lines
      .filter((line) => !line.product.controlaStock)
      .map((line) => ({ productId: line.product.id, quantity: line.quantity, opcionNombre: line.opcionNombre }));
    const movimientosInsumos = itemsParaInsumos.length > 0
      ? await deductInsumosInTx(stores, itemsParaInsumos, saleId, fecha, now)
      : [];

    return {
      saleId, fecha, hora, totalCentavos, saleMode,
      _syncPayload: {
        venta: { fecha, hora, totalCentavos, saleMode, creadoEn: now, uuid: ventaUuid },
        detalles: _detallesSync,
        movimientosStock: _movStockSync,
        movimientosInsumos
      }
    };
  });
}

export async function salesForDay(fecha = todayISO()) {
  const [sales, details] = await Promise.all([getAll("ventas"), getAll("detalle_venta")]);
  const detailsBySale = new Map();
  details
    .filter((detail) => detail.fecha === fecha)
    .forEach((detail) => {
      const list = detailsBySale.get(detail.ventaId) || [];
      list.push(detail);
      detailsBySale.set(detail.ventaId, list);
    });

  return sales
    .filter((sale) => sale.fecha === fecha && !sale.anulada)
    .sort((a, b) => b.id - a.id)
    .map((sale) => ({ ...sale, saleMode: sale.saleMode || "normal", detalles: detailsBySale.get(sale.id) || [] }));
}

// Deshace una venta: devuelve al stock cada producto vendido (las lineas
// sinteticas como descuentos de combo, tarifa ToGoo o ajustes de precio de
// pedido no tienen producto real, asi que se ignoran solas). Para productos
// que controlan stock, se devuelve el producto. Para los que no (cafe,
// bebidas — se descuentan por insumo en el momento de la venta, ver
// confirmSale), se devuelven los insumos correspondientes, respetando la
// misma variante de leche que se vendio (guardada en detalle.opcionNombre).
// No se borra la venta ni su detalle — se marca "anulada". salesForDay() la
// excluye del historial y de los totales (asi que desaparece igual para el
// uso normal), pero el registro queda por si hace falta revisarlo despues.
export async function undoSale(ventaId) {
  const fecha = todayISO();
  const now = new Date().toISOString();

  return withStores(["ventas", "detalle_venta", "productos", "movimientos_stock", "insumos", "movimientos_insumos", "recetas", "configuracion"], "readwrite", async (stores) => {
    const venta = await requestToPromise(stores.ventas.get(ventaId));
    if (!venta) throw new Error("La venta no existe.");
    if (venta.anulada) throw new Error("Esta venta ya fue deshecha antes.");

    const detalles = await requestToPromise(stores.detalle_venta.index("ventaId").getAll(ventaId));

    const movimientosStock = [];
    const itemsParaRestituirInsumos = [];
    for (const detalle of detalles) {
      const product = await requestToPromise(stores.productos.get(detalle.productoId));
      if (!product) continue;
      if (product.controlaStock) {
        const stockAnterior = product.stockActual;
        const stockNuevo = stockAnterior + detalle.cantidad;
        stores.productos.put({ ...product, stockActual: stockNuevo, actualizadoEn: now });
        const movimiento = {
          uuid: crypto.randomUUID(),
          productoId: product.id,
          tipo: "devolucion",
          cantidad: detalle.cantidad,
          stockAnterior,
          stockNuevo,
          referencia: `Venta #${ventaId} anulada`,
          fecha,
          creadoEn: now
        };
        stores.movimientos_stock.add(movimiento);
        movimientosStock.push(movimiento);
      } else {
        itemsParaRestituirInsumos.push({ productId: detalle.productoId, quantity: detalle.cantidad, opcionNombre: detalle.opcionNombre || null });
      }
    }

    const movimientosInsumos = itemsParaRestituirInsumos.length > 0
      ? await restoreInsumosInTx(stores, itemsParaRestituirInsumos, ventaId, fecha, now)
      : [];

    stores.ventas.put({ ...venta, anulada: true, anuladaEn: now });

    // Se devuelve el uuid (identidad compartida entre local y Supabase) para
    // encontrar la fila correspondiente en la nube — el id local y el id que
    // le asigna Supabase a la venta son secuencias distintas, no sirven para
    // matchear. fecha/creadoEn quedan de respaldo por si la venta es de antes
    // de este cambio y todavia no tiene uuid.
    return { uuid: venta.uuid || null, fecha: venta.fecha, creadoEn: venta.creadoEn, movimientosStock, movimientosInsumos };
  });
}
