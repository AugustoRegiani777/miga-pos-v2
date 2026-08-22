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
    const error = new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
    error.status = res.status;
    try { error.body = JSON.parse(text); } catch { error.body = null; }
    throw error;
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

// Upsert contra una columna que NO es la primary key (por ejemplo "uuid" en
// tablas con id autoincremental). Necesario para que reintentar un push que
// en verdad ya se habia guardado (se corto la respuesta, no la escritura) no
// termine creando una fila duplicada — resuelve contra el uuid en vez de
// insertar una fila nueva cada vez.
function upsertOnConflict(table, data, conflictColumn) {
  const rows = Array.isArray(data) ? data : [data];
  return sbFetch(`/${table}?on_conflict=${conflictColumn}`, "POST", rows, {
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

// Cada insert de abajo resuelve por "uuid" (generado en la tablet al crear
// el registro, no por el id autoincremental de Supabase). Esto hace que
// reintentar un push que en realidad ya se habia guardado (se corto la
// respuesta pero la escritura llego) actualice la misma fila en vez de
// duplicarla — y de paso, el uuid es el identificador que sirve para
// referenciar esta venta puntual desde otro dispositivo (ver updateVentaAnulada).
// Los pedidos solo se marcan "listo" una vez (patchEstadoPedido exige el
// estado anterior "pendiente"), asi que un pedido_id nunca deberia tener mas
// de una venta real. Si ya existe una, el reintento se descarta aca en vez
// de insertar de nuevo — cierra la puerta a la duplicacion sin depender de
// que el uuid este bien puesto en el payload que quedo encolado (localStorage
// guarda el payload congelado del momento en que se armo, asi que un fix de
// codigo no alcanza para lo que ya estaba en cola antes del fix).
async function ventaExistentePorPedido(pedidoId) {
  if (!pedidoId) return null;
  const rows = await sbFetch(`/ventas?pedido_id=eq.${pedidoId}&select=id&limit=1`);
  return rows?.[0]?.id ?? null;
}

export async function pushVenta({ venta, detalles, movimientosStock }) {
  if (venta.origen === "pedido" && venta.pedidoId) {
    const existente = await ventaExistentePorPedido(venta.pedidoId);
    if (existente != null) return existente;
  }

  let ventaId;
  try {
    const [ventaRow] = await upsertOnConflict("ventas", {
      uuid: venta.uuid,
      fecha: venta.fecha,
      hora: venta.hora,
      total_centavos: venta.totalCentavos,
      sale_mode: venta.saleMode || "normal",
      origen: venta.origen || null,
      pedido_id: venta.pedidoId || null,
      cliente_nombre: venta.clienteNombre || null,
      creado_en: venta.creadoEn
    }, "uuid");
    ventaId = ventaRow.id;
  } catch (error) {
    // Red de seguridad contra la carrera del chequeo de arriba (dos
    // reintentos casi simultaneos podrian leer "no existe" antes de que
    // ninguno termine de insertar): si la base rechaza por el indice unico
    // de pedido_id (ver migracion 003), no es un fallo real — el pedido ya
    // tiene su venta, solo hay que devolver ese id en vez de reintentar.
    const esConflictoPedidoDuplicado = error?.body?.code === "23505" && venta.pedidoId
      && JSON.stringify(error.body).includes("ventas_pedido_id_unique");
    if (!esConflictoPedidoDuplicado) throw error;
    const existente = await ventaExistentePorPedido(venta.pedidoId);
    if (existente == null) throw error;
    ventaId = existente;
  }

  if (detalles.length > 0) {
    await upsertOnConflict("detalle_venta", detalles.map(d => ({
      uuid: d.uuid,
      venta_id: ventaId,
      producto_id: d.productoId,
      producto_nombre: d.productoNombre,
      cantidad: d.cantidad,
      precio_unitario_centavos: d.precioUnitarioCentavos,
      subtotal_centavos: d.subtotalCentavos,
      fecha: d.fecha,
      creado_en: d.creadoEn
    })), "uuid");
  }

  if (movimientosStock.length > 0) {
    await upsertOnConflict("movimientos_stock", movimientosStock.map(m => ({
      uuid: m.uuid,
      producto_id: m.productoId,
      tipo: m.tipo,
      cantidad: m.cantidad,
      stock_anterior: m.stockAnterior,
      stock_nuevo: m.stockNuevo,
      motivo: m.motivo || null,
      referencia: m.referencia || null,
      fecha: m.fecha,
      creado_en: m.creadoEn
    })), "uuid");
  }

  return ventaId;
}

export async function pushCalibracion(evento) {
  return upsertOnConflict("historial_calibraciones", {
    uuid: evento.uuid,
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
  }, "uuid");
}

// El catalogo (categorias/productos) vive en el codigo (seed.js), no se edita
// desde la app — esto solo espeja lo que ya dice seed.js hacia Supabase para
// que el dashboard (y cualquier otro consumidor) pueda hacer JOIN contra un
// catalogo real en vez de mantener su propia copia a mano.
export async function pushCatalogoSnapshot(categorias, productos) {
  await upsert("categorias", categorias.map(c => ({
    id: c.id,
    nombre: c.nombre,
    orden: c.orden
  })));
  return upsert("productos", productos.map(p => ({
    id: p.id,
    categoria_id: p.categoriaId,
    nombre: p.nombre,
    precio_centavos: p.precioCentavos,
    sandwich_tipo: p.sandwichTipo || null,
    umbral_bajo: p.umbralBajo,
    controla_stock: p.controlaStock !== false,
    orden: p.orden,
    activo: p.activo !== false
  })));
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

export async function pushProveedoresSnapshot(proveedores) {
  return upsert("proveedores", proveedores.map(p => ({
    id: p.id,
    nombre: p.nombre,
    tel: p.tel || null,
    email: p.email || null,
    notas: p.notas || null,
    dias_ciclo: p.diasCiclo,
    activo: p.activo !== false,
    actualizado_en: new Date().toISOString()
  })));
}

// nombre_producto es la denominacion propia de cada proveedor para ese
// insumo — la pieza que despues usa la lectura de facturas para matchear.
export async function pushProveedorInsumosSnapshot(proveedorInsumos) {
  return upsert("proveedor_insumos", proveedorInsumos.map(pi => ({
    id: pi.id,
    proveedor_id: pi.proveedorId,
    insumo_id: pi.insumoId || null,
    nombre_producto: pi.nombreProducto || null,
    unidad_compra: pi.unidadCompra || null,
    cantidad_por_unidad: pi.cantidadPorUnidad,
    precio_unitario_centavos: pi.precioUnitarioCentavos,
    activo: pi.activo !== false,
    actualizado_en: new Date().toISOString()
  })));
}

export async function pushMovimientosInsumos(movimientos) {
  if (!movimientos || movimientos.length === 0) return;
  return upsertOnConflict("movimientos_insumos", movimientos.map(m => ({
    uuid: m.uuid,
    insumo_id: m.insumoId,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stock_anterior: m.stockAnterior,
    stock_nuevo: m.stockNuevo,
    producto_id: m.productoId || null,
    venta_id_local: m.ventaId || null,
    fecha: m.fecha,
    creado_en: m.creadoEn
  })), "uuid");
}

// --- Sync para "modo consulta" (Caja/Produccion/Historial de solo lectura
// en otros dispositivos) — el dispositivo que opera de verdad empuja estos
// snapshots fire-and-forget; los demas los leen en vez de su IDB local. ---

export async function pushStockProductos(productos) {
  return upsert("stock_productos", productos.map(p => ({
    id: p.id,
    stock_actual: p.stockActual,
    actualizado_en: p.actualizadoEn || new Date().toISOString()
  })));
}

export async function pushProduccionDiaria(rows) {
  if (!rows || rows.length === 0) return;
  return upsert("produccion_diaria", rows.map(r => ({
    id: r.id,
    producto_id: r.productoId,
    fecha: r.fecha,
    cantidad: r.cantidad,
    creado_en: r.creadoEn,
    actualizado_en: r.actualizadoEn || new Date().toISOString()
  })));
}

// Se llama cuando se deshace una venta localmente, para que "modo consulta"
// deje de contarla tambien. El id local de la venta NO es el mismo que el id
// que le asigno Supabase al pushearla (son secuencias auto-increment
// distintas) — por eso se matchea por uuid (identidad compartida generada en
// la tablet). fecha+creado_en queda como respaldo solo para ventas de antes
// de este cambio, que todavia no tienen uuid.
export async function updateVentaAnulada({ uuid, fecha, creadoEn }) {
  const filtro = uuid
    ? `uuid=eq.${encodeURIComponent(uuid)}`
    : `fecha=eq.${fecha}&creado_en=eq.${encodeURIComponent(creadoEn)}`;
  return sbFetch(`/ventas?${filtro}`, "PATCH", {
    anulada: true,
    anulada_en: new Date().toISOString()
  });
}

export async function fetchStockProductos() {
  return sbFetch("/stock_productos?select=id,stock_actual,actualizado_en");
}

export async function fetchProduccionDiaria(fecha) {
  return sbFetch(`/produccion_diaria?fecha=eq.${fecha}`);
}

export async function pushMovimientoStock(m) {
  return upsertOnConflict("movimientos_stock", {
    uuid: m.uuid,
    producto_id: m.productoId,
    tipo: m.tipo,
    cantidad: m.cantidad,
    stock_anterior: m.stockAnterior,
    stock_nuevo: m.stockNuevo,
    motivo: m.motivo || null,
    referencia: m.referencia || null,
    fecha: m.fecha,
    creado_en: m.creadoEn
  }, "uuid");
}

// Trae todos los movimientos del dia; el filtro de cuales son "de produccion"
// (tipo produccion/ajuste_manual, o ajuste_stock por error) se hace en el cliente,
// igual que productionSnapshot() en business.js.
export async function fetchMovimientosStock(fecha) {
  return sbFetch(`/movimientos_stock?fecha=eq.${fecha}&order=creado_en.asc`);
}

// Trae los movimientos DESDE una fecha en adelante (inclusive) — sirve para
// reconstruir cuanto stock habia en un dia pasado, restando del stock actual
// todo lo que cambio despues. Ojo: los movimientos de produccion recien
// empiezan a sincronizarse desde que se agrego este sync (ver CLAUDE.md /
// historial de cambios) — para fechas muy anteriores a eso, la reconstruccion
// puede no ser exacta hasta que se acumule mas historial en Supabase.
export async function fetchMovimientosStockDesde(fecha) {
  return sbFetch(`/movimientos_stock?fecha=gte.${fecha}&order=fecha.asc`);
}

export async function fetchVentasDelDia(fecha) {
  return sbFetch(`/ventas?fecha=eq.${fecha}&anulada=not.is.true&select=*,detalle_venta(*)&order=id.desc`);
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
