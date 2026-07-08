const SUPABASE_URL = "https://iknytfgqkdddtqpykgab.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlrbnl0Zmdxa2RkZHRxcHlrZ2FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NjY1OTQsImV4cCI6MjA5ODI0MjU5NH0.1qAJ71w1DaZu1i0G5an6AOuLwyu4_OU-uMvms4AjM0w";

const BASE = `${SUPABASE_URL}/rest/v1`;
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;
const SESSION_KEY = "miga_auth_session";

// --- Sesion (login con usuario/contraseña, Supabase Auth) ---

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function saveSession(session) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  catch { /* localStorage lleno o no disponible */ }
}

function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* ignorar */ }
}

function sessionFromAuthResponse(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000
  };
}

async function authFetch(path, body) {
  let res;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method: "POST",
      headers: { "apikey": SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch {
    // fetch tira una excepcion cuando no hay red (no un status de error) —
    // se marca aparte para no confundirla con un rechazo real del servidor.
    const networkError = new Error("Sin conexion con el servidor de autenticacion.");
    networkError.isNetworkError = true;
    throw networkError;
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(data?.error_description || data?.msg || `Error de autenticacion (${res.status})`);
  }
  return data;
}

export async function signIn(email, password) {
  const data = await authFetch("/token?grant_type=password", { email, password });
  const session = sessionFromAuthResponse(data);
  saveSession(session);
  return session;
}

export function signOut() {
  clearSession();
}

async function refreshSession(session) {
  const data = await authFetch("/token?grant_type=refresh_token", { refresh_token: session.refreshToken });
  const newSession = sessionFromAuthResponse(data);
  saveSession(newSession);
  return newSession;
}

// Se llama al arrancar la app: si hay sesion guardada, la refresca para
// confirmar que el refresh token sigue vivo (el access token dura 1h, poco
// importa si ya vencio con tal de que se pueda renovar).
// Offline-first: si el refresh falla porque NO HAY RED, no se cierra la
// sesion (la app tiene que poder abrirse sin wifi) — se confia en la sesion
// guardada y se reintenta sola la proxima vez que haya una llamada a
// Supabase. Solo se cierra sesion si el servidor confirma que el refresh
// token es invalido (rechazo real, no un problema de conexion).
export async function restoreSession() {
  const session = loadSession();
  if (!session) return null;
  try {
    return await refreshSession(session);
  } catch (error) {
    if (error.isNetworkError) return session;
    clearSession();
    return null;
  }
}

function authHeaders(accessToken) {
  return {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json"
  };
}

async function sbFetch(path, method = "GET", body = null, extra = {}) {
  let session = loadSession();
  const doFetch = (accessToken) => fetch(`${BASE}${path}`, {
    method,
    headers: { ...authHeaders(accessToken), ...extra },
    body: body != null ? JSON.stringify(body) : undefined
  });

  let res = await doFetch(session?.accessToken);

  if (res.status === 401 && session?.refreshToken) {
    try {
      session = await refreshSession(session);
      res = await doFetch(session.accessToken);
    } catch {
      clearSession();
    }
  }

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
    const session = loadSession();
    const res = await fetch(`${BASE}/ventas?select=id&limit=1`, { headers: authHeaders(session?.accessToken) });
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

// Pedidos: fuente de verdad en Supabase (no hay store espejo en IDB local),
// para que un pedido creado desde cualquier dispositivo sea visible en el local.
export async function fetchPedidos() {
  return sbFetch(`/pedidos?select=*,detalle_pedido(*)&order=fecha_hora_retiro.asc`);
}

export async function pushPedido({ pedido, detalles }) {
  const [pedidoRow] = await insert("pedidos", {
    cliente_nombre: pedido.clienteNombre,
    fecha_hora_retiro: pedido.fechaHoraRetiro,
    pagado: pedido.pagado,
    cortado_mitad: pedido.cortadoMitad,
    aclaraciones: pedido.aclaraciones || null,
    total_centavos: pedido.totalCentavos
  });
  const pedidoId = pedidoRow.id;

  if (detalles.length > 0) {
    await insert("detalle_pedido", detalles.map(d => ({
      pedido_id: pedidoId,
      producto_id: d.productoId,
      producto_nombre: d.productoNombre,
      cantidad: d.cantidad,
      precio_unitario_centavos: d.precioUnitarioCentavos
    })));
  }

  return pedidoId;
}

export async function updatePedido(pedidoId, pedido) {
  return sbFetch(`/pedidos?id=eq.${pedidoId}`, "PATCH", {
    cliente_nombre: pedido.clienteNombre,
    fecha_hora_retiro: pedido.fechaHoraRetiro,
    pagado: pedido.pagado,
    cortado_mitad: pedido.cortadoMitad,
    aclaraciones: pedido.aclaraciones || null,
    total_centavos: pedido.totalCentavos
  });
}

// Reemplaza todas las lineas del pedido (borra las viejas, inserta las nuevas)
// en vez de tratar de calcular un diff — mas simple y sin casos raros.
export async function replaceDetallesPedido(pedidoId, detalles) {
  await sbFetch(`/detalle_pedido?pedido_id=eq.${pedidoId}`, "DELETE");
  if (detalles.length > 0) {
    await insert("detalle_pedido", detalles.map(d => ({
      pedido_id: pedidoId,
      producto_id: d.productoId,
      producto_nombre: d.productoNombre,
      cantidad: d.cantidad,
      precio_unitario_centavos: d.precioUnitarioCentavos
    })));
  }
}

// Borra el pedido; detalle_pedido se borra en cascada (ON DELETE CASCADE).
export async function deletePedido(pedidoId) {
  return sbFetch(`/pedidos?id=eq.${pedidoId}`, "DELETE");
}

// Filtro de concurrencia: solo aplica la transicion si el pedido sigue en estadoEsperado.
// result.length === 0 significa que otro dispositivo ya hizo esta transicion antes.
export async function patchEstadoPedido(pedidoId, estadoNuevo, estadoEsperado, extraFields = {}) {
  const result = await sbFetch(
    `/pedidos?id=eq.${pedidoId}&estado=eq.${estadoEsperado}`,
    "PATCH",
    { estado: estadoNuevo, ...extraFields },
    { "Prefer": "return=representation" }
  );
  return result.length > 0;
}
