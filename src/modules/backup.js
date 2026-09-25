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
        cantidad: m.cantidad,
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

const CATEGORY_ORDER = ["Sandwiches", "Bolleria", "Cafe", "Bebidas", "Otros"];
const MOTIVOS_SALIDA = ["Baja por desperdicio", "Consumo"];

function esMotivoErrorProduccion(motivo) {
  return motivo === "Error de produccion" || motivo === "Error";
}

// Cierre del dia, ordenado de arriba hacia abajo:
//   1. Resumen (plata): ventas + paquetes Too Good To Go = total general
//   2. Ventas por categoria (Sandwiches / Bolleria / Cafe / Bebidas)
//   3. Too Good To Go: cuantos paquetes se vendieron y que salio adentro
//   4. Stock de productos terminados: de ayer + producido - salidas = quedan
//   5. Salidas sin venta (perdida): desperdicio y consumo, valuadas
//   6. Detalle venta a venta
export async function buildSalesSummaryText(fecha) {
  const { sales, products, snapshot, historico, stockAdjustments } = await obtenerDatosDelDia(fecha);
  const productsById = new Map(products.map((p) => [p.id, p]));
  const productsByName = new Map(products.map((p) => [normalizeText(p.nombre), p]));

  const ventasPorProducto = new Map();
  const toGooPorProducto = new Map();
  const bajaVentaPorProducto = new Map();
  let descuentosCentavos = 0;
  let paquetesToGoo = 0;
  let ingresoToGooCentavos = 0;

  const resolver = (detail, nombreLimpio) => {
    const product = productsById.get(detail.productoId) || productsByName.get(normalizeText(nombreLimpio));
    return {
      key: product?.id || detail.productoId || normalizeText(nombreLimpio),
      nombre: product?.nombre || nombreLimpio,
      categoria: product?.categoria || inferCategory(nombreLimpio)
    };
  };
  const acumular = (mapa, info, detail) => {
    const row = mapa.get(info.key) || { nombre: info.nombre, categoria: info.categoria, cantidad: 0, totalCentavos: 0 };
    row.cantidad += detail.cantidad;
    row.totalCentavos += detail.subtotalCentavos;
    mapa.set(info.key, row);
  };

  for (const sale of sales) {
    for (const detail of sale.detalles) {
      if (isDiscountDetail(detail)) {
        descuentosCentavos += detail.subtotalCentavos;
        continue;
      }
      if (isToGooDetail(detail)) {
        // La "Tarifa ToGoo" es lo que se cobra por el paquete (una por
        // paquete); las demas lineas son lo que salio adentro, a valor 0.
        if (detail.productoId === "togoo-fee") {
          paquetesToGoo += detail.cantidad;
          ingresoToGooCentavos += detail.subtotalCentavos;
        } else {
          acumular(toGooPorProducto, resolver(detail, cleanToGooName(detail.productoNombre)), detail);
        }
        continue;
      }
      if (isBajaDetail(detail)) {
        acumular(bajaVentaPorProducto, resolver(detail, cleanBajaName(detail.productoNombre)), detail);
        continue;
      }
      acumular(ventasPorProducto, resolver(detail, detail.productoNombre), detail);
    }
  }

  const sumar = (mapa, campo) => Array.from(mapa.values()).reduce((s, r) => s + r[campo], 0);
  const ventasBrutoCentavos = sumar(ventasPorProducto, "totalCentavos");
  const ingresosVentasCentavos = ventasBrutoCentavos + descuentosCentavos;
  const totalGeneralCentavos = ingresosVentasCentavos + ingresoToGooCentavos;
  const unidadesVendidas = sumar(ventasPorProducto, "cantidad");
  const unidadesToGoo = sumar(toGooPorProducto, "cantidad");

  // ---- Salidas sin venta: desperdicio, consumo (valuadas) ----
  const salidas = new Map(); // motivo -> Map(key -> { nombre, unidades, valorCentavos })
  const addSalida = (motivo, key, nombre, unidades) => {
    const porProducto = salidas.get(motivo) || new Map();
    const fila = porProducto.get(key) || { nombre, unidades: 0, valorCentavos: 0 };
    fila.unidades += unidades;
    fila.valorCentavos += unidades * (Number(productsById.get(key)?.precioCentavos) || 0);
    porProducto.set(key, fila);
    salidas.set(motivo, porProducto);
  };
  for (const [key, row] of bajaVentaPorProducto) addSalida("Baja por desperdicio", key, row.nombre, row.cantidad);

  const correcciones = [];
  const otrosAjustes = [];
  for (const m of stockAdjustments) {
    const delta = Number.isFinite(Number(m.cantidad)) && m.cantidad != null
      ? Number(m.cantidad)
      : (Number(m.stockNuevo) || 0) - (Number(m.stockAnterior) || 0);
    const nombre = productsById.get(m.productoId)?.nombre || m.productoId;
    const motivo = m.motivo || m.referencia || "Sin motivo";
    if (esMotivoErrorProduccion(motivo)) correcciones.push({ nombre, delta });
    else if (MOTIVOS_SALIDA.includes(motivo)) addSalida(motivo, m.productoId, nombre, -delta);
    else otrosAjustes.push({ nombre, motivo, delta });
  }

  // ---- Stock de productos terminados: cierra o avisa ----
  const filasStock = (lista) => lista
    .filter((p) => p.controlaStock)
    .map((p) => {
      const h = historico.get(p.id);
      const ayer = h?.stockAlInicio ?? 0;
      const prod = Number(p.cantidadProducida) || 0;
      const vend = ventasPorProducto.get(p.id)?.cantidad || 0;
      const tgtg = toGooPorProducto.get(p.id)?.cantidad || 0;
      const baja = bajaVentaPorProducto.get(p.id)?.cantidad || 0;
      const ajuste = h?.ajuste ?? 0;
      const quedan = h?.stockAlFinal ?? (Number(p.stockActual) || 0);
      const esperado = ayer + prod - vend - tgtg - baja + ajuste;
      return { nombre: p.nombre, ayer, prod, vend, tgtg, baja, ajuste, quedan, esperado };
    })
    .filter((r) => r.ayer || r.prod || r.vend || r.tgtg || r.baja || r.ajuste || r.quedan);

  const horaGenerado = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const lines = [
    "MIGA POS — CIERRE DEL DÍA",
    "=".repeat(50),
    `Fecha:    ${fecha}`,
    `Generado: ${horaGenerado}`
  ];

  // 1. RESUMEN
  lines.push(...section("RESUMEN DEL DÍA"));
  lines.push(`${padR("Transacciones:", 34)} ${padL(sales.length, 5)}`);
  lines.push(`${padR("Unidades vendidas:", 34)} ${padL(unidadesVendidas, 5)}`);
  lines.push(`${padR("Paquetes Too Good To Go:", 34)} ${padL(paquetesToGoo, 5)}`);
  lines.push("");
  lines.push(`${padR("Ventas:", 34)} ${padL(centsToMoney(ventasBrutoCentavos), 12)}`);
  if (descuentosCentavos !== 0) {
    lines.push(`${padR("Descuentos de combo:", 34)} ${padL(centsToMoney(descuentosCentavos), 12)}`);
  }
  lines.push(`${padR("Ingresos por ventas:", 34)} ${padL(centsToMoney(ingresosVentasCentavos), 12)}`);
  lines.push(`${padR(`Ingresos Too Good To Go (${paquetesToGoo} paq.):`, 34)} ${padL(centsToMoney(ingresoToGooCentavos), 12)}`);
  lines.push(`${padR("TOTAL GENERAL:", 34)} ${padL(centsToMoney(totalGeneralCentavos), 12)}`);

  // 2. VENTAS POR CATEGORIA
  lines.push(...section("VENTAS POR CATEGORÍA"));
  const porCategoria = new Map(CATEGORY_ORDER.map((c) => [c, []]));
  for (const row of ventasPorProducto.values()) {
    porCategoria.get(porCategoria.has(row.categoria) ? row.categoria : "Otros").push(row);
  }
  if (ventasPorProducto.size === 0) {
    lines.push("  (sin ventas registradas)");
  } else {
    let primera = true;
    for (const cat of CATEGORY_ORDER) {
      const rows = porCategoria.get(cat).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre));
      if (!rows.length) continue;
      if (!primera) lines.push("");
      primera = false;
      lines.push(`  — ${cat.toUpperCase()} —`);
      lines.push(`  ${padR("Producto", 30)}  ${padL("Cant", 5)}  ${padL("Monto", 12)}`);
      lines.push(`  ${SEP_THIN.slice(0, 51)}`);
      for (const row of rows) {
        lines.push(`  ${padR(row.nombre, 30)}  ${padL(row.cantidad, 5)}  ${padL(centsToMoney(row.totalCentavos), 12)}`);
      }
      const cant = rows.reduce((s, r) => s + r.cantidad, 0);
      const monto = rows.reduce((s, r) => s + r.totalCentavos, 0);
      lines.push(`  ${padR("SUBTOTAL " + cat.toUpperCase(), 30)}  ${padL(cant, 5)}  ${padL(centsToMoney(monto), 12)}`);
    }
    if (descuentosCentavos !== 0) {
      lines.push("");
      lines.push(`  ${padR("Descuentos de combo", 30)}  ${padL("", 5)}  ${padL(centsToMoney(descuentosCentavos), 12)}`);
    }
  }

  // 3. TOO GOOD TO GO
  lines.push(...section("TOO GOOD TO GO"));
  if (paquetesToGoo === 0 && unidadesToGoo === 0) {
    lines.push("  (sin paquetes hoy)");
  } else {
    lines.push(`${padR("Paquetes vendidos:", 34)} ${padL(paquetesToGoo, 5)}`);
    lines.push(`${padR("Ingreso (3 € por paquete):", 34)} ${padL(centsToMoney(ingresoToGooCentavos), 12)}`);
    lines.push(`${padR("Unidades que salieron adentro:", 34)} ${padL(unidadesToGoo, 5)}  (a valor 0)`);
    lines.push("");
    lines.push("  Qué salió en los paquetes:");
    const filas = Array.from(toGooPorProducto.values()).sort((a, b) => b.cantidad - a.cantidad || a.nombre.localeCompare(b.nombre));
    for (const row of filas) {
      lines.push(`  ${padR(row.nombre, 34)} ${padL(row.cantidad, 5)}`);
    }
  }

  // 4. STOCK DE PRODUCTOS TERMINADOS
  lines.push(...section("STOCK: DE AYER + PRODUCIDO − SALIDAS = QUEDAN"));
  const encabezado = `  ${padR("Producto", 24)} ${padL("Ayer", 5)} ${padL("Prod", 5)} ${padL("Vend", 5)} ${padL("TGTG", 5)} ${padL("Baja", 5)} ${padL("Ajus", 5)} ${padL("Quedan", 6)}`;
  const grupos = [
    ["SANDWICHES", snapshot.sandwiches],
    ["BOLLERÍA", snapshot.bolleria],
    ["BEBIDAS", snapshot.bebidas]
  ];
  const noCierran = [];
  let hayStock = false;
  for (const [titulo, lista] of grupos) {
    const filas = filasStock(lista);
    if (!filas.length) continue;
    if (hayStock) lines.push("");
    hayStock = true;
    lines.push(`  — ${titulo} —`);
    lines.push(encabezado);
    lines.push(`  ${"─".repeat(encabezado.length - 2)}`);
    const tot = { ayer: 0, prod: 0, vend: 0, tgtg: 0, baja: 0, ajuste: 0, quedan: 0 };
    for (const f of filas) {
      const marca = f.esperado === f.quedan ? "" : " ≠";
      lines.push(`  ${padR(f.nombre, 24)} ${padL(f.ayer, 5)} ${padL(f.prod, 5)} ${padL(f.vend, 5)} ${padL(f.tgtg, 5)} ${padL(f.baja, 5)} ${padL(f.ajuste, 5)} ${padL(f.quedan, 6)}${marca}`);
      if (f.esperado !== f.quedan) noCierran.push(f);
      for (const k of Object.keys(tot)) tot[k] += f[k];
    }
    lines.push(`  ${padR("TOTAL", 24)} ${padL(tot.ayer, 5)} ${padL(tot.prod, 5)} ${padL(tot.vend, 5)} ${padL(tot.tgtg, 5)} ${padL(tot.baja, 5)} ${padL(tot.ajuste, 5)} ${padL(tot.quedan, 6)}`);
  }
  if (!hayStock) {
    lines.push("  (sin movimiento de stock)");
  } else {
    lines.push("");
    lines.push("  TGTG = salió en paquete Too Good To Go (valor 0). Baja/Ajus = salidas sin venta.");
    if (correcciones.length > 0) {
      lines.push("  Correcciones por error de producción (ya incluidas en Prod):");
      for (const c of correcciones) lines.push(`    ${padR(c.nombre, 30)} ${c.delta > 0 ? "+" : ""}${c.delta}`);
    }
    for (const f of noCierran) {
      lines.push(`  ⚠ ${f.nombre}: la cuenta da ${f.esperado} pero el sistema dice ${f.quedan} — falta cargar una salida o una venta.`);
    }
  }
  if (snapshot.comentarios.length > 0) {
    lines.push("");
    lines.push("  COMENTARIOS DEL DÍA:");
    for (const comment of snapshot.comentarios) lines.push(`    · ${comment}`);
  }

  // 5. SALIDAS SIN VENTA (perdida)
  lines.push(...section("SALIDAS SIN VENTA (PÉRDIDA A PRECIO DE VENTA)"));
  if (salidas.size === 0) {
    lines.push("  (sin bajas por desperdicio ni consumo)");
  } else {
    let totalUnidades = 0;
    let totalValor = 0;
    for (const motivo of MOTIVOS_SALIDA) {
      const porProducto = salidas.get(motivo);
      if (!porProducto) continue;
      const filas = Array.from(porProducto.values()).sort((a, b) => b.unidades - a.unidades);
      const unidades = filas.reduce((s, f) => s + f.unidades, 0);
      const valor = filas.reduce((s, f) => s + f.valorCentavos, 0);
      totalUnidades += unidades;
      totalValor += valor;
      lines.push(`  — ${motivo.toUpperCase()} —`);
      lines.push(`  ${padR("Producto", 30)}  ${padL("Unid", 5)}  ${padL("Valor", 12)}`);
      lines.push(`  ${SEP_THIN.slice(0, 51)}`);
      for (const f of filas) lines.push(`  ${padR(f.nombre, 30)}  ${padL(f.unidades, 5)}  ${padL(centsToMoney(f.valorCentavos), 12)}`);
      lines.push(`  ${padR("SUBTOTAL", 30)}  ${padL(unidades, 5)}  ${padL(centsToMoney(valor), 12)}`);
      lines.push("");
    }
    lines.push(`  ${padR("TOTAL PÉRDIDA", 30)}  ${padL(totalUnidades, 5)}  ${padL(centsToMoney(totalValor), 12)}`);
  }
  if (otrosAjustes.length > 0) {
    lines.push("");
    lines.push("  OTROS AJUSTES DE STOCK:");
    for (const a of otrosAjustes) lines.push(`    ${padR(a.nombre, 26)} ${padL(a.delta > 0 ? "+" + a.delta : a.delta, 5)}  ${a.motivo}`);
  }

  // 6. DETALLE VENTA A VENTA
  lines.push(...section("DETALLE VENTA A VENTA"));
  const sortedSales = sales.slice().sort((a, b) => a.id - b.id);
  for (const sale of sortedSales) {
    const esPaquete = sale.detalles.some((d) => d.productoId === "togoo-fee");
    lines.push(`Venta #${sale.id}  ·  ${sale.hora}  ·  ${centsToMoney(sale.totalCentavos)}${esPaquete ? "  ·  Too Good To Go" : ""}`);
    for (const detail of sale.detalles) {
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
