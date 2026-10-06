import { getAll } from "../db/idb.js";
import { fetchVentasRango, fetchStockProductos, fetchStockInsumos } from "../db/supabase.js";
import { listProducts, mapVentaRemota } from "./business.js";
import { sumarDias } from "./panel-calculos.js";

// Ventana que trae el Panel: 14 dias terminando en la fecha elegida (alcanza
// para la tendencia y para comparar contra el mismo dia de la semana anterior).
export const DIAS_TENDENCIA = 14;

// Mismo formato que mapVentaRemota, armado desde la base local de este dispositivo.
async function ventasLocalesRango(desde, hasta) {
  const [ventas, detalles] = await Promise.all([getAll("ventas"), getAll("detalle_venta")]);
  const detallesPorVenta = new Map();
  for (const d of detalles) {
    if (d.fecha < desde || d.fecha > hasta) continue;
    (detallesPorVenta.get(d.ventaId) || detallesPorVenta.set(d.ventaId, []).get(d.ventaId)).push(d);
  }
  return ventas
    .filter((v) => v.fecha >= desde && v.fecha <= hasta && !v.anulada)
    .map((v) => ({ ...v, saleMode: v.saleMode || "normal", detalles: detallesPorVenta.get(v.id) || [] }));
}

// La nube es la verdad (ventas de todos los dispositivos y stock derivado). Sin
// conexion la tablet igual muestra lo suyo: ventas locales y stock local.
export async function cargarPanel(fecha) {
  const desde = sumarDias(fecha, -(DIAS_TENDENCIA - 1));
  const [productos, insumosLocales] = await Promise.all([listProducts(), getAll("insumos")]);
  let insumos = insumosLocales.filter((i) => i.activo);
  let productosConStock = productos;
  let ventas;
  let fuente = "nube";

  try {
    const [filas, stockProductos, stockInsumos] = await Promise.all([
      fetchVentasRango(desde, fecha),
      fetchStockProductos(),
      fetchStockInsumos()
    ]);
    ventas = filas.map(mapVentaRemota);
    const stockP = new Map(stockProductos.map((r) => [r.id, Number(r.stock_actual)]));
    const stockI = new Map(stockInsumos.map((r) => [r.id, Number(r.stock_actual)]));
    productosConStock = productos.map((p) => (stockP.has(p.id) ? { ...p, stockActual: stockP.get(p.id) } : p));
    insumos = insumos.map((i) => (stockI.has(i.id) ? { ...i, stockActual: stockI.get(i.id) } : i));
  } catch {
    fuente = "local";
    ventas = await ventasLocalesRango(desde, fecha);
  }

  return {
    fecha,
    fuente,
    ventas,
    productos: productosConStock,
    productosPorId: new Map(productos.map((p) => [p.id, p])),
    insumos
  };
}
