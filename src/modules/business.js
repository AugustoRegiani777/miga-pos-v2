import { getAll, requestToPromise, withStores } from "../db/idb.js";
import { currentTime, todayISO } from "../utils/format.js";
import { calculateCartPricing } from "./pricing.js";
import { deductInsumosForProductionInTx, deductInsumosInTx, restoreInsumosInTx } from "./aprovisionamiento.js";

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
  return withStores(["configuracion"], "readwrite", async (stores) => {
    const currentRow = await requestToPromise(stores.configuracion.get(productionCommentKey(fecha)));
    const comentarios = normalizeProductionComments(currentRow?.valor);
    comentarios.push(comentario);
    stores.configuracion.put({
      id: productionCommentKey(fecha),
      valor: comentarios,
      actualizadoEn: now
    });
  });
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
