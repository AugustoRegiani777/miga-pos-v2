const SUPABASE_URL = "https://iknytfgqkdddtqpykgab.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrbnl0Zmdxa2RkZHRxcHlrZ2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjY1OTQsImV4cCI6MjA5ODI0MjU5NH0.1qAJ71w1DaZu1i0G5an6AOuLwyu4_OU-uMvms4AjM0w";

const BASE = `${SUPABASE_URL}/rest/v1`;

const HEADERS = {
  "apikey": SUPABASE_ANON_KEY,
  "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
  "Content-Type": "application/json"
};

async function sbFetch(path, method = "GET", body = null, extra = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...HEADERS, ...extra },
    body: body != null ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

function insert(table, data) {
  const rows = Array.isArray(data) ? data : [data];
  return sbFetch(`/${table}`, "POST", rows, { "Prefer": "return=representation" });
}

function upsert(table, data) {
  const rows = Array.isArray(data) ? data : [data];
  return sbFetch(`/${table}`, "POST", rows, {
    "Prefer": "resolution=merge-duplicates,return=representation"
  });
}

export async function testConnection() {
  try {
    const res = await fetch(`${BASE}/ventas?select=id&limit=1`, { headers: HEADERS });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pushVenta({ venta, detalles, movimientosStock }) {
  const [ventaRow] = await insert("ventas", {
    fecha: venta.fecha,
    hora: venta.hora,
    total_centavos: venta.totalCentavos,
    sale_mode: venta.saleMode || "normal",
    creado_en: venta.creadoEn
  });
  const ventaId = ventaRow.id;

  if (detalles.length > 0) {
    await insert("detalle_venta", detalles.map(d => ({
      venta_id: ventaId,
      producto_id: d.productoId,
      producto_nombre: d.productoNombre,
      cantidad: d.cantidad,
      precio_unitario_centavos: d.precioUnitarioCentavos,
      subtotal_centavos: d.subtotalCentavos,
      fecha: d.fecha,
      creado_en: d.creadoEn
    })));
  }

  if (movimientosStock.length > 0) {
    await insert("movimientos_stock", movimientosStock.map(m => ({
      producto_id: m.productoId,
      tipo: m.tipo,
      cantidad: m.cantidad,
      stock_anterior: m.stockAnterior,
      stock_nuevo: m.stockNuevo,
      motivo: m.motivo || null,
      referencia: m.referencia || null,
      fecha: m.fecha,
      creado_en: m.creadoEn
    })));
  }

  return ventaId;
}

export async function pushCalibracion(evento) {
  return insert("historial_calibraciones", {
    insumo_id: evento.insumoId,
    fecha: evento.fecha,
    stock_antes: evento.stockAntes,
    stock_real: evento.stockReal,
    sandwiches: evento.sandwiches,
    consumo_esperado: evento.consumoEsperado,
    consumo_real: evento.consumoReal,
    factor_observado: evento.factorObservado,
    factor_clamped: evento.factorClamped,
    alpha_usado: evento.alphaUsado,
    estimado_antes: evento.estimadoAntes,
    estimado_despues: evento.estimadoDespues,
    creado_en: evento.creadoEn
  });
}

export async function pushInsumosSnapshot(insumos) {
  return upsert("insumos", insumos.map(i => ({
    id: i.id,
    nombre: i.nombre,
    unidad: i.unidad,
    unidad_compra: i.unidadCompra || null,
    factor_conversion: i.factorConversion,
    stock_actual: i.stockActual,
    stock_minimo: i.stockMinimo,
    stock_critico: i.stockCritico,
    necesita_calibracion: i.necesitaCalibracion || false,
    ultima_calibracion: i.ultimaCalibracion || null,
    activo: i.activo !== false,
    actualizado_en: i.actualizadoEn || new Date().toISOString()
  })));
}

export async function pushRecetasSnapshot(recetas) {
  return upsert("recetas", recetas.map(r => ({
    id: r.id,
    producto_id: r.productoId,
    insumo_id: r.insumoId,
    cantidad_por_unidad: r.cantidadPorUnidad,
    es_estimado: r.esEstimado || false,
    actualizado_en: r.actualizadoEn || new Date().toISOString()
  })));
}

export async function pushMovimientosInsumos(movimientos) {
  if (!movimientos || movimientos.length === 0) return;
  return insert("movimientos_insumos", movimientos.map(m => ({
    insumo_id: m.insumoId,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stock_anterior: m.stockAnterior,
    stock_nuevo: m.stockNuevo,
    venta_id_local: m.ventaId || null,
    fecha: m.fecha,
    creado_en: m.creadoEn
  })));
}
