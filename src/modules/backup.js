import { exportAllData, getAll, importAllData } from "../db/idb.js";
import { listProducts, productionSnapshot, salesForDay, stockHistoricoPorFecha, datosRemotosDelDia } from "./business.js";
import { centsToMoney, downloadText, shareOrDownloadText, shareOrDownloadBlob, normalizeText, todayISO } from "../utils/format.js";
import { createZip } from "../utils/zip.js";

const MODO_CONSULTA_KEY = "miga_modo_consulta";

function isModoConsulta() {
  try { return localStorage.getItem(MODO_CONSULTA_KEY) === "1"; }
  catch { return false; }
}

// El exportador tiene que funcionar igual de bien desde CUALQUIER
// dispositivo, no solo la tablet que realmente opera — antes, generarlo
// desde otro dispositivo (el celu, una pestaña vieja) leia una base local
// vacia y entregaba un archivo prolijo pero en cero, sin avisar que estaba
// mirando en el lugar equivocado (incidente real, 19/09/2026). En modo
// consulta se trae todo de Supabase (ver datosRemotosDelDia en business.js);
// en el dispositivo que opera, se sigue leyendo local como siempre — mismos
// datos, misma forma exacta, el resto de este archivo no necesita saber de
// donde salieron.
async function obtenerDatosDelDia(fecha) {
  if (isModoConsulta()) {
    const { sales, products, snapshot, historico, movimientosDelDia } = await datosRemotosDelDia(fecha);
    // Normalizado a la MISMA forma (camelCase) que movimientos_stock local,
    // para que el resto de este archivo arme "AJUSTES DE STOCK" sin tener
    // que saber si los datos vinieron de local o de la nube.
    const stockAdjustments = movimientosDelDia
      .filter((m) => m.tipo === "ajuste_stock")
      .map((m) => ({
        productoId: m.producto_id,
        stockAnterior: m.stock_anterior,
        stockNuevo: m.stock_nuevo,
        motivo: m.motivo,
        referencia: m.referencia,
        creadoEn: m.creado_en
      }))
      .sort((a, b) => String(a.creadoEn || "").localeCompare(String(b.creadoEn || "")));
    return { sales, products, snapshot, historico, stockAdjustments };
  }
  const [sales, products, snapshot, historico, movimientosStock] = await Promise.all([
    salesForDay(fecha),
    listProducts(),
    productionSnapshot(fecha),
    stockHistoricoPorFecha(fecha),
    getAll("movimientos_stock")
  ]);
  const stockAdjustments = movimientosStock
    .filter((m) => m.fecha === fecha && m.tipo === "ajuste_stock")
    .sort((a, b) => String(a.creadoEn || "").localeCompare(String(b.creadoEn || "")));
  return { sales, products, snapshot, historico, stockAdjustments };
}

const FALLBACK_CATEGORIES = [
  {
    categoria: "Sandwiches",
    names: [
      "jamon y queso",
      "pasta oliva y queso",
      "pimiento asado, gouda, philp",
      "pesto y tomate",
      "pesto, tomate y queso",
      "berenjena y queso brie",
      "jamon serrano y rucula",
      "atun, palta y queso",
      "salmon ahumado y phil",
      "huevo y jamon",
      "huevo y queso",
      "especial semanal"
    ]
  },
  {
    categoria: "Bolleria",
    names: ["croissant", "mini croissant", "mini croissant ddl", "pain au chocolat", "chipa", "alfajor havana"]
  },
  {
    categoria: "Cafe",
    names: ["expresso 30ml", "cortado", "latte", "cafe con leche", "capuccino", "americano", "flat white", "ice latte", "ice caramel"]
  },
  {
    categoria: "Bebidas",
    names: ["cerveza", "coca cola", "sprite", "nestea", "aquiarios", "jugo", "agua"]
  }
];

function inferCategory(productName) {
  const normalizedName = normalizeText(productName);
  const match = FALLBACK_CATEGORIES.find((group) =>
    group.names.some((name) => normalizeText(name) === normalizedName)
  );
  return match?.categoria || "Otros";
}

function isToGooDetail(detail) {
  return detail.productoNombre.includes("ToGoo");
}

function isBajaDetail(detail) {
  return detail.productoNombre.includes("BAJA");
}

function isDiscountDetail(detail) {
  return detail.productoNombre.startsWith("Descuento ");
}

function cleanToGooName(productName) {
  return productName.replace(/\s+ToGoo$/, "");
}

function cleanBajaName(productName) {
  return productName.replace(/\s+BAJA$/, "");
}

const SEP = "═".repeat(50);
const SEP_THIN = "─".repeat(50);

function section(title) {
  return ["", SEP, ` ${title}`, SEP, ""];
}

function padR(str, width) {
  return String(str).padEnd(width, " ").slice(0, width);
}

function padL(str, width) {
  return String(str).padStart(width, " ").slice(-width);
}

export async function buildSalesSummaryText(fecha) {
  const { sales, products, snapshot, historico, stockAdjustments } = await obtenerDatosDelDia(fecha);
  const productsById = new Map(products.map((p) => [p.id, p]));
  const productsByName = new Map(products.map((p) => [normalizeText(p.nombre), p]));

  const salesSummary = new Map();
  const toGooByProduct = new Map();
  const bajaByProduct = new Map();
  let totalVentaCentavos = 0;
  let totalToGooCentavos = 0;
  let totalBajaCentavos = 0;
  let totalToGooUnidades = 0;
  let totalBajaUnidades = 0;

  for (const sale of sales) {
    for (const detail of sale.detalles) {
      if (isDiscountDetail(detail)) {
        totalVentaCentavos += detail.subtotalCentavos;
        continue;
      }

      if (isToGooDetail(detail)) {
        totalToGooCentavos += detail.subtotalCentavos;
        totalToGooUnidades += detail.cantidad;
        const cleanName = cleanToGooName(detail.productoNombre);
        const key = detail.productoId || normalizeText(cleanName);
        const row = toGooByProduct.get(key) || { nombre: cleanName, cantidad: 0, totalCentavos: 0 };
        row.cantidad += detail.cantidad;
        row.totalCentavos += detail.subtotalCentavos;
        toGooByProduct.set(key, row);
        continue;
      }

      if (isBajaDetail(detail)) {
        totalBajaCentavos += detail.subtotalCentavos;
        totalBajaUnidades += detail.cantidad;
        const cleanName = cleanBajaName(detail.productoNombre);
        const key = detail.productoId || normalizeText(cleanName);
        const row = bajaByProduct.get(key) || { nombre: cleanName, cantidad: 0 };
        row.cantidad += detail.cantidad;
        bajaByProduct.set(key, row);
        continue;
      }

      totalVentaCentavos += detail.subtotalCentavos;

      const product = productsById.get(detail.productoId) || productsByName.get(normalizeText(detail.productoNombre));
      const key = product?.id || normalizeText(detail.productoNombre);
      const row = salesSummary.get(key) || {
        nombre: product?.nombre || detail.productoNombre,
        categoria: product?.categoria || inferCategory(detail.productoNombre),
        cantidad: 0,
        totalCentavos: 0,
        primeraVenta: sale.hora,
        ultimaVenta: sale.hora
      };
      row.cantidad += detail.cantidad;
      row.totalCentavos += detail.subtotalCentavos;
      row.primeraVenta = row.primeraVenta < sale.hora ? row.primeraVenta : sale.hora;
      row.ultimaVenta = row.ultimaVenta > sale.hora ? row.ultimaVenta : sale.hora;
      salesSummary.set(key, row);
    }
  }

  const totalSandwichesProduced = snapshot.sandwiches.reduce(
    (sum, p) => sum + (Number(p.cantidadProducida) || 0), 0
  );
  const totalBolleriaProduced = snapshot.bolleria.reduce(
    (sum, p) => sum + (Number(p.cantidadProducida) || 0), 0
  );
  const totalSandwichesVendidos = Array.from(salesSummary.entries())
    .filter(([key]) => {
      const p = productsById.get(key);
      return p?.categoriaId === "sandwiches" && p?.controlaStock;
    })
    .reduce((sum, [, row]) => sum + row.cantidad, 0);

  const totalSandwichesDisponibles = snapshot.sandwiches.reduce(
    (sum, p) => sum + (historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0)), 0
  );
  const totalStockAyer = snapshot.sandwiches.reduce(
    (sum, p) => sum + (historico.get(p.id)?.stockAlInicio ?? 0), 0
  );

  let totalBebidasVendidas = 0;
  for (const [key, row] of salesSummary) {
    const prod = productsById.get(key);
    if (prod?.categoriaId === "bebidas" || prod?.categoriaId === "cafe") {
      totalBebidasVendidas += row.cantidad;
    }
    if (key === "promo-bebida" || key === "promo-cafe-con-leche") {
      totalBebidasVendidas += row.cantidad;
    }
  }

  const horaGenerado = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const lines = [
    "MIGA POS — CIERRE DEL DÍA",
    "=".repeat(50),
    `Fecha:    ${fecha}`,
    `Generado: ${horaGenerado}`
  ];

  // Resumen ejecutivo
  lines.push(...section("RESUMEN EJECUTIVO"));
  lines.push(`${padR("Transacciones registradas:", 34)} ${padL(sales.length, 5)}`);
  lines.push(`${padR("Sandwiches de ayer (arrastre):", 34)} ${padL(totalStockAyer, 5)}`);
  lines.push(`${padR("Sandwiches producidos hoy:", 34)} ${padL(totalSandwichesProduced, 5)}`);
  lines.push(`${padR("Total sandwiches disponibles hoy:", 34)} ${padL(totalStockAyer + totalSandwichesProduced, 5)}`);
  lines.push(SEP_THIN.slice(0, 40));
  lines.push(`${padR("Sandwiches vendidos:", 34)} ${padL(totalSandwichesVendidos, 5)}`);
  lines.push(`${padR("Sandwiches quedan:", 34)} ${padL(totalSandwichesDisponibles, 5)}`);
  lines.push(`${padR("Bebidas vendidas:", 34)} ${padL(totalBebidasVendidas, 5)}`);
  lines.push(`${padR("Salidas ToGoo (unidades):", 34)} ${padL(totalToGooUnidades, 5)}`);
  lines.push("");
  lines.push(`${padR("Ingresos ventas:", 34)} ${padL(centsToMoney(totalVentaCentavos), 12)}`);
  lines.push(`${padR("Ingresos ToGoo:", 34)} ${padL(centsToMoney(totalToGooCentavos), 12)}`);
  lines.push(`${padR("TOTAL GENERAL:", 34)} ${padL(centsToMoney(totalVentaCentavos + totalToGooCentavos), 12)}`);

  // Producción del día
  lines.push(...section("PRODUCCIÓN DEL DÍA"));

  const sandwichesConProd = snapshot.sandwiches.filter((p) => p.cantidadProducida > 0);
  const sandwichesSinProd = snapshot.sandwiches.filter((p) => p.cantidadProducida === 0);
  lines.push(`SANDWICHES — total producido: ${totalSandwichesProduced}`);
  if (sandwichesConProd.length > 0) {
    for (const p of sandwichesConProd) {
      lines.push(`  ${padR(p.nombre, 34)} ${padL(p.cantidadProducida, 4)}`);
    }
  } else {
    lines.push("  (sin produccion registrada)");
  }
  if (sandwichesSinProd.length > 0) {
    lines.push("  — no producidos hoy:");
    for (const p of sandwichesSinProd) {
      lines.push(`  ${padR(p.nombre, 34)}    0`);
    }
  }
  lines.push("");

  const bolleriaConProd = snapshot.bolleria.filter((p) => p.cantidadProducida > 0);
  const bolleriaSinProd = snapshot.bolleria.filter((p) => p.controlaStock && p.cantidadProducida === 0);
  lines.push(`BOLLERIA — total producido: ${totalBolleriaProduced}`);
  if (bolleriaConProd.length > 0) {
    for (const p of bolleriaConProd) {
      lines.push(`  ${padR(p.nombre, 34)} ${padL(p.cantidadProducida, 4)}`);
    }
  } else {
    lines.push("  (sin produccion registrada)");
  }
  if (bolleriaSinProd.length > 0) {
    lines.push("  — no producidos hoy:");
    for (const p of bolleriaSinProd) {
      lines.push(`  ${padR(p.nombre, 34)}    0`);
    }
  }

  if (snapshot.comentarios.length > 0) {
    lines.push("");
    lines.push("COMENTARIOS DEL DÍA:");
    for (const comment of snapshot.comentarios) {
      lines.push(`  · ${comment}`);
    }
  }

  // Ranking de ventas
  lines.push(...section("VENTAS POR PRODUCTO — RANKING"));

  const rankingRows = Array.from(salesSummary.values())
    .sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre));

  if (rankingRows.length === 0) {
    lines.push("  (sin ventas registradas)");
  } else {
    const CATEGORY_ORDER = ["Sandwiches", "Bolleria", "Cafe", "Bebidas", "Otros"];
    const byCategory = new Map(CATEGORY_ORDER.map((cat) => [cat, []]));
    for (const row of rankingRows) {
      const cat = byCategory.has(row.categoria) ? row.categoria : "Otros";
      byCategory.get(cat).push(row);
    }
    const header = `  ${padL("#", 3)}  ${padR("Producto", 28)}  ${padL("Cant", 5)}  ${padL("Monto", 12)}`;
    let rank = 1;
    let firstCat = true;
    for (const cat of CATEGORY_ORDER) {
      const rows = byCategory.get(cat);
      if (!rows.length) continue;
      if (!firstCat) lines.push("");
      firstCat = false;
      lines.push(`  — ${cat.toUpperCase()} —`);
      lines.push(header);
      lines.push(`  ${SEP_THIN.slice(0, 54)}`);
      let catCantidad = 0;
      let catCentavos = 0;
      for (const row of rows) {
        lines.push(`  ${padL(rank++, 3)}  ${padR(row.nombre, 28)}  ${padL(row.cantidad, 5)}  ${padL(centsToMoney(row.totalCentavos), 12)}`);
        catCantidad += row.cantidad;
        catCentavos += row.totalCentavos;
      }
      lines.push(`       ${padR("SUBTOTAL", 28)}  ${padL(catCantidad, 5)}  ${padL(centsToMoney(catCentavos), 12)}`);
    }
  }

  // Producción vs ventas (sandwiches)
  lines.push(...section("SANDWICHES: PRODUCCIÓN vs VENTAS"));

  lines.push(`  ${padR("Sandwich", 28)}  ${padL("Ayer", 5)}  ${padL("Hoy", 5)}  ${padL("Vend", 5)}  ${padL("Quedan", 6)}`);
  lines.push(`  ${SEP_THIN.slice(0, 56)}`);
  for (const p of snapshot.sandwiches) {
    const vendido = salesSummary.get(p.id)?.cantidad || 0;
    const stockFinal = historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0);
    const ayer = historico.get(p.id)?.stockAlInicio ?? 0;
    lines.push(`  ${padR(p.nombre, 28)}  ${padL(ayer, 5)}  ${padL(p.cantidadProducida, 5)}  ${padL(vendido, 5)}  ${padL(stockFinal, 6)}`);
  }

  // ToGoo
  lines.push(...section("SALIDAS TOGOO"));

  if (toGooByProduct.size === 0) {
    lines.push("  (sin salidas ToGoo)");
  } else {
    lines.push(`  ${padR("Producto", 30)}  ${padL("Cant", 5)}  ${padL("Monto", 12)}`);
    lines.push(`  ${SEP_THIN.slice(0, 50)}`);
    for (const row of toGooByProduct.values()) {
      lines.push(`  ${padR(row.nombre, 30)}  ${padL(row.cantidad, 5)}  ${padL(centsToMoney(row.totalCentavos), 12)}`);
    }
    lines.push(`  ${padR("TOTAL", 30)}  ${padL(totalToGooUnidades, 5)}  ${padL(centsToMoney(totalToGooCentavos), 12)}`);
  }

  // Baja
  lines.push(...section("SALIDAS BAJA"));

  if (bajaByProduct.size === 0) {
    lines.push("  (sin salidas por baja)");
  } else {
    lines.push(`  ${padR("Producto", 30)}  ${padL("Cant", 5)}`);
    lines.push(`  ${SEP_THIN.slice(0, 37)}`);
    for (const row of bajaByProduct.values()) {
      lines.push(`  ${padR(row.nombre, 30)}  ${padL(row.cantidad, 5)}`);
    }
    lines.push(`  ${padR("TOTAL", 30)}  ${padL(totalBajaUnidades, 5)}`);
  }

  // Ajustes de stock
  lines.push(...section("AJUSTES DE STOCK"));

  if (stockAdjustments.length === 0) {
    lines.push("  (sin ajustes de stock)");
  } else {
    lines.push(`  ${padR("Producto", 28)}  ${padL("Antes", 5)} → ${padL("Desp.", 5)}  Motivo`);
    lines.push(`  ${SEP_THIN.slice(0, 50)}`);
    for (const m of stockAdjustments) {
      const product = productsById.get(m.productoId);
      const nombre = product?.nombre || m.productoId;
      const motivo = m.motivo || m.referencia || "Sin motivo";
      lines.push(`  ${padR(nombre, 28)}  ${padL(m.stockAnterior, 5)} → ${padL(m.stockNuevo, 5)}  ${motivo}`);
    }
  }

  // Detalle venta a venta
  lines.push(...section("DETALLE VENTA A VENTA"));

  const sortedSales = sales.slice().sort((a, b) => a.id - b.id);
  for (const sale of sortedSales) {
    const pureDetails = sale.detalles.filter((d) => !isToGooDetail(d) && !isBajaDetail(d));
    if (pureDetails.length === 0) continue;
    const saleTotal = pureDetails.reduce((sum, d) => sum + d.subtotalCentavos, 0);
    lines.push(`Venta #${sale.id}  ·  ${sale.hora}  ·  ${centsToMoney(saleTotal)}`);
    for (const detail of pureDetails) {
      lines.push(`  ${detail.cantidad} x ${padR(detail.productoNombre, 30)} ${padL(centsToMoney(detail.subtotalCentavos), 12)}`);
    }
    lines.push("");
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}

function nombreArchivoCierre(fecha) {
  const [yyyy, mm, dd] = fecha.split("-");
  return `${dd}-${mm}-${yyyy}-miga-cierre.txt`;
}

export async function exportSalesSummary(fecha) {
  const text = await buildSalesSummaryText(fecha);
  await shareOrDownloadText(nombreArchivoCierre(fecha), text, "text/plain;charset=utf-8");
}

// Aritmetica pura sobre los numeros de la fecha (UTC de punta a punta) — si
// se mezcla "new Date(unaFechaLocal)" con ".toISOString()" (UTC), el
// resultado se corre un dia entero segun la zona horaria del dispositivo.
function* fechasEnRango(fechaDesde, fechaHasta) {
  const [y1, m1, d1] = fechaDesde.split("-").map(Number);
  const [y2, m2, d2] = fechaHasta.split("-").map(Number);
  const unDiaMs = 24 * 60 * 60 * 1000;
  const fin = Date.UTC(y2, m2 - 1, d2);
  for (let t = Date.UTC(y1, m1 - 1, d1); t <= fin; t += unDiaMs) {
    const cursor = new Date(t);
    const yyyy = cursor.getUTCFullYear();
    const mm = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(cursor.getUTCDate()).padStart(2, "0");
    yield `${yyyy}-${mm}-${dd}`;
  }
}

// Un TXT de cierre por cada dia del rango (inclusive), empaquetados en un
// solo ZIP — para bajar de una un periodo entero en vez de dia por dia.
export async function exportSalesSummaryRange(fechaDesde, fechaHasta) {
  if (fechaHasta < fechaDesde) {
    throw new Error("La fecha 'hasta' no puede ser anterior a 'desde'.");
  }
  const dias = Array.from(fechasEnRango(fechaDesde, fechaHasta));
  if (dias.length > 366) {
    throw new Error("El rango es demasiado largo (máximo 366 días).");
  }

  const files = [];
  for (const fecha of dias) {
    const text = await buildSalesSummaryText(fecha);
    files.push({ name: nombreArchivoCierre(fecha), content: text });
  }

  const zipBlob = createZip(files);
  const nombreZip = `miga-historial-${fechaDesde}-a-${fechaHasta}.zip`;
  await shareOrDownloadBlob(nombreZip, zipBlob);
  return dias.length;
}

export async function exportDailySummaryJSON(fecha) {
  const { sales, products, snapshot, historico } = await obtenerDatosDelDia(fecha);
  const productsById = new Map(products.map((p) => [p.id, p]));
  const productsByName = new Map(products.map((p) => [normalizeText(p.nombre), p]));

  // Consolidar ventas por producto
  const salesSummary = new Map();
  const togooSummary = new Map();
  const bajaSummary = new Map();
  let totalVentaCentavos = 0;
  let totalToGooCentavos = 0;
  let totalToGooUnidades = 0;
  let totalBajaUnidades = 0;

  for (const sale of sales) {
    for (const detail of sale.detalles) {
      if (isDiscountDetail(detail)) { totalVentaCentavos += detail.subtotalCentavos; continue; }

      if (isToGooDetail(detail)) {
        totalToGooCentavos += detail.subtotalCentavos;
        totalToGooUnidades += detail.cantidad;
        const cleanName = cleanToGooName(detail.productoNombre);
        const key = detail.productoId || normalizeText(cleanName);
        const row = togooSummary.get(key) || { productoId: key, nombre: cleanName, cantidad: 0, totalCentavos: 0 };
        row.cantidad += detail.cantidad;
        row.totalCentavos += detail.subtotalCentavos;
        togooSummary.set(key, row);
        continue;
      }

      if (isBajaDetail(detail)) {
        totalBajaUnidades += detail.cantidad;
        const cleanName = cleanBajaName(detail.productoNombre);
        const key = detail.productoId || normalizeText(cleanName);
        const row = bajaSummary.get(key) || { productoId: key, nombre: cleanName, cantidad: 0 };
        row.cantidad += detail.cantidad;
        bajaSummary.set(key, row);
        continue;
      }

      totalVentaCentavos += detail.subtotalCentavos;
      const product = productsById.get(detail.productoId) || productsByName.get(normalizeText(detail.productoNombre));
      const key = product?.id || normalizeText(detail.productoNombre);
      const row = salesSummary.get(key) || {
        productoId: key,
        nombre: product?.nombre || detail.productoNombre,
        categoriaId: product?.categoriaId || "otros",
        cantidad: 0,
        totalCentavos: 0,
        primeraVenta: sale.hora,
        ultimaVenta: sale.hora
      };
      row.cantidad += detail.cantidad;
      row.totalCentavos += detail.subtotalCentavos;
      if (sale.hora < row.primeraVenta) row.primeraVenta = sale.hora;
      if (sale.hora > row.ultimaVenta) row.ultimaVenta = sale.hora;
      salesSummary.set(key, row);
    }
  }

  const totalSandwichesProducidos = snapshot.sandwiches.reduce((s, p) => s + (Number(p.cantidadProducida) || 0), 0);
  const totalBolleriaProducida = snapshot.bolleria.reduce((s, p) => s + (Number(p.cantidadProducida) || 0), 0);
  const totalSandwichesVendidos = Array.from(salesSummary.values())
    .filter(r => productsById.get(r.productoId)?.categoriaId === "sandwiches" && productsById.get(r.productoId)?.controlaStock)
    .reduce((s, r) => s + r.cantidad, 0);
  const totalSandwichesRestantes = snapshot.sandwiches.reduce(
    (s, p) => s + (historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0)), 0
  );
  const sandwichesAyer = snapshot.sandwiches.reduce(
    (s, p) => s + (historico.get(p.id)?.stockAlInicio ?? 0), 0
  );

  const payload = {
    _meta: { app: "Miga POS", version: "v2", exportadoEn: new Date().toISOString() },
    fecha,
    resumen: {
      transacciones: sales.length,
      sandwichesAyer,
      sandwichesProducidos: totalSandwichesProducidos,
      sandwichesVendidos: totalSandwichesVendidos,
      sandwichesRestantes: totalSandwichesRestantes,
      ingresosCentavos: totalVentaCentavos,
      togooCentavos: totalToGooCentavos,
      totalCentavos: totalVentaCentavos + totalToGooCentavos
    },
    ventas: {
      porProducto: Array.from(salesSummary.values()).sort((a, b) => b.cantidad - a.cantidad)
    },
    produccion: {
      totalSandwiches: totalSandwichesProducidos,
      totalBolleria: totalBolleriaProducida,
      sandwiches: snapshot.sandwiches.map(p => ({
        productoId: p.id,
        nombre: p.nombre,
        cantidadProducida: Number(p.cantidadProducida) || 0,
        stockRestante: historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0)
      })),
      bolleria: snapshot.bolleria.map(p => ({
        productoId: p.id,
        nombre: p.nombre,
        cantidadProducida: Number(p.cantidadProducida) || 0,
        stockRestante: historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0)
      })),
      comentarios: snapshot.comentarios || []
    },
    togoo: {
      total: totalToGooUnidades,
      totalCentavos: totalToGooCentavos,
      porProducto: Array.from(togooSummary.values())
    },
    baja: {
      total: totalBajaUnidades,
      porProducto: Array.from(bajaSummary.values())
    }
  };

  const [yyyy, mm, dd] = fecha.split("-");
  await shareOrDownloadText(
    `${dd}-${mm}-${yyyy}-miga-cierre.json`,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8"
  );
}

export async function exportFullBackup() {
  const payload = await exportAllData();
  const text = JSON.stringify(payload, null, 2);
  downloadText(`miga-pos-backup-${todayISO()}.json`, text, "application/json;charset=utf-8");
}

export async function importFullBackup(file) {
  if (!file) {
    throw new Error("Selecciona un archivo JSON de backup.");
  }

  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("El archivo no es un JSON valido.");
  }

  if (!window.confirm("Esto reemplaza los datos actuales de la tablet por el backup seleccionado. ¿Continuar?")) {
    return false;
  }

  await importAllData(payload);
  return true;
}
