import { getAll, requestToPromise, withStores } from "../db/idb.js";
import { currentTime, todayISO } from "../utils/format.js";
import { calculateCartPricing } from "./pricing.js";
import { deductInsumosForProductionInTx } from "./aprovisionamiento.js";

const PRODUCTION_CATEGORIES = new Set(["sandwiches", "bolleria"]);
export const TOGOO_FLAT_TOTAL_CENTAVOS = 300;
const DECREASE_ONLY_MOTIVOS = new Set(["Consumo", "Pedidos offline"]);
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
    const lineKey = `${item.productId}:${saleMode}`;
    const currentLine = lines.get(lineKey) || { productId: item.productId, quantity: 0, saleMode, unitOrders: [] };
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
  const productionRows = (await getAll("produccion_diaria")).filter((row) => row.fecha === fecha);
  const productionComments = await withStores(["configuracion"], "readonly", async (stores) => {
    const row = await requestToPromise(stores.configuracion.get(productionCommentKey(fecha)));
    return normalizeProductionComments(row?.valor);
  });
  const productionMovements = (await getAll("movimientos_stock"))
    .filter((row) => row.fecha === fecha && (
      row.tipo === "produccion" ||
      row.tipo === "ajuste_manual" ||
      (row.tipo === "ajuste_stock" && (row.motivo === "Error de produccion" || row.motivo === "Error"))
    ))
    .sort((a, b) => String(a.creadoEn || "").localeCompare(String(b.creadoEn || "")));
  const producedByProduct = new Map(productionRows.map((row) => [row.productoId, row.cantidad]));
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
  return {
    fecha,
    comentarios: productionComments,
    sandwiches: products
      .filter((product) => product.categoriaId === "sandwiches" && product.controlaStock)
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || []
      })),
    bolleria: products
      .filter((product) => product.categoriaId === "bolleria")
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || []
      })),
    productionProducts: products
      .filter((product) => PRODUCTION_CATEGORIES.has(product.categoriaId) && product.controlaStock)
      .map((product) => ({
        ...product,
        cantidadProducida: producedByProduct.get(product.id) || 0,
        movimientosProduccion: movementsByProduct.get(product.id) || []
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
      ({ warnings } = await deductInsumosForProductionInTx(stores, productId, cantidad, fecha, now));
    }

    stores.productos.put({ ...product, stockActual: nuevoStock, actualizadoEn: now });
    stores.movimientos_stock.add({
      productoId: productId,
      tipo: "ajuste_stock",
      cantidad,
      stockAnterior,
      stockNuevo: nuevoStock,
      referencia: `Ajuste stock: ${motivo}`,
      motivo,
      fecha,
      creadoEn: now
    });

    return { warnings };
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
    stores.movimientos_stock.add({
      productoId: productId,
      tipo: "produccion",
      cantidad,
      stockAnterior,
      stockNuevo,
      referencia: `Produccion ${fecha}`,
      fecha,
      creadoEn: now
    });
    const { warnings } = await deductInsumosForProductionInTx(stores, productId, cantidad, fecha, now);
    return { warnings };
  });
}

export async function confirmSale(items) {
  const cart = groupCartItems(items);
  const fecha = todayISO();
  const hora = currentTime();
  const now = new Date().toISOString();

  return withStores(["productos", "ventas", "detalle_venta", "movimientos_stock"], "readwrite", async (stores) => {
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
      lines.push({
        product,
        quantity: item.quantity,
        saleMode: lineSaleMode,
        productName: lineSaleMode === "togoo" ? `${product.nombre} ToGoo` : lineSaleMode === "baja" ? `${product.nombre} BAJA` : product.nombre,
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

    const saleId = await requestToPromise(stores.ventas.add({ fecha, hora, totalCentavos, saleMode, creadoEn: now }));

    for (const line of lines) {
      const detalle = {
        ventaId: saleId,
        productoId: line.product.id,
        productoNombre: line.productName,
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

    return {
      saleId, fecha, hora, totalCentavos, saleMode,
      _syncPayload: {
        venta: { fecha, hora, totalCentavos, saleMode, creadoEn: now },
        detalles: _detallesSync,
        movimientosStock: _movStockSync,
        movimientosInsumos: []
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
// pedido no tienen producto real, asi que se ignoran solas). Los insumos no
// se tocan: se consumen en produccion, no en la venta, asi que no hay nada
// que revertir ahi.
// No se borra la venta ni su detalle — se marca "anulada". salesForDay() la
// excluye del historial y de los totales (asi que desaparece igual para el
// uso normal), pero el registro queda por si hace falta revisarlo despues.
export async function undoSale(ventaId) {
  const fecha = todayISO();
  const now = new Date().toISOString();

  return withStores(["ventas", "detalle_venta", "productos", "movimientos_stock"], "readwrite", async (stores) => {
    const venta = await requestToPromise(stores.ventas.get(ventaId));
    if (!venta) throw new Error("La venta no existe.");
    if (venta.anulada) throw new Error("Esta venta ya fue deshecha antes.");

    const detalles = await requestToPromise(stores.detalle_venta.index("ventaId").getAll(ventaId));

    for (const detalle of detalles) {
      const product = await requestToPromise(stores.productos.get(detalle.productoId));
      if (product && product.controlaStock) {
        const stockAnterior = product.stockActual;
        const stockNuevo = stockAnterior + detalle.cantidad;
        stores.productos.put({ ...product, stockActual: stockNuevo, actualizadoEn: now });
        stores.movimientos_stock.add({
          productoId: product.id,
          tipo: "devolucion",
          cantidad: detalle.cantidad,
          stockAnterior,
          stockNuevo,
          referencia: `Venta #${ventaId} anulada`,
          fecha,
          creadoEn: now
        });
      }
    }

    stores.ventas.put({ ...venta, anulada: true, anuladaEn: now });
  });
}
