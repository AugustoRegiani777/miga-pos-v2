import { requestToPromise, withStores } from "../db/idb.js";
import { currentTime, todayISO } from "../utils/format.js";
import {
  fetchPedidos as fetchPedidosSb,
  pushPedido,
  updatePedido,
  replaceDetallesPedido,
  deletePedido,
  patchEstadoPedido
} from "../db/supabase.js";

function mapPedidoRow(row) {
  return {
    id: row.id,
    clienteNombre: row.cliente_nombre,
    fechaHoraRetiro: row.fecha_hora_retiro,
    pagado: row.pagado,
    cortadoMitad: row.cortado_mitad,
    aclaraciones: row.aclaraciones,
    totalCentavos: row.total_centavos,
    estado: row.estado,
    creadoEn: row.creado_en,
    listoEn: row.listo_en,
    entregadoEn: row.entregado_en,
    items: (row.detalle_pedido || []).map((d) => ({
      productId: d.producto_id,
      nombre: d.producto_nombre,
      cantidad: d.cantidad,
      precioUnitarioCentavos: d.precio_unitario_centavos
    }))
  };
}

export async function fetchPedidosDelDia() {
  const rows = await fetchPedidosSb();
  const hoy = todayISO();
  return rows
    .map(mapPedidoRow)
    .filter((p) => p.estado !== "entregado" || String(p.fechaHoraRetiro).slice(0, 10) === hoy);
}

function buildPedidoPayload({ clienteNombre, fechaHoraRetiro, pagado, cortadoMitad, aclaraciones, totalCentavos, items }) {
  const nombre = String(clienteNombre || "").trim();
  if (!nombre) throw new Error("Falta el nombre del cliente.");
  if (!fechaHoraRetiro) throw new Error("Falta la fecha y hora de retiro.");
  if (!items || items.length === 0) throw new Error("El pedido no tiene productos.");
  if (!Number.isFinite(totalCentavos) || totalCentavos < 0) throw new Error("El precio total no es valido.");

  const detalles = items.map((item) => ({
    productoId: item.productId,
    productoNombre: item.nombre,
    cantidad: item.cantidad,
    precioUnitarioCentavos: item.precioUnitarioCentavos
  }));

  return {
    pedido: {
      clienteNombre: nombre,
      fechaHoraRetiro,
      pagado: !!pagado,
      cortadoMitad: !!cortadoMitad,
      aclaraciones: String(aclaraciones || "").trim(),
      totalCentavos
    },
    detalles
  };
}

export async function crearPedido(input) {
  const { pedido, detalles } = buildPedidoPayload(input);
  return pushPedido({ pedido, detalles });
}

// Reemplaza nombre/fecha/items del pedido. Se puede editar en cualquier estado
// (pendiente/listo/entregado) — si ya se descontó stock al marcarlo preparado,
// eso no se toca aca, solo se corrige el registro del pedido en si.
export async function editarPedido(pedidoId, input) {
  const { pedido, detalles } = buildPedidoPayload(input);
  await updatePedido(pedidoId, pedido);
  await replaceDetallesPedido(pedidoId, detalles);
}

export async function eliminarPedido(pedidoId) {
  await deletePedido(pedidoId);
}

// Marca el pedido "preparado". Esto es lo que descuenta el stock de mostrador
// (como una venta), porque en ese momento los sandwiches ya estan armados y
// guardados esperando que los retiren: si el sistema dice "20 de jamon y queso"
// pero 5 son de un pedido ya preparado, en realidad solo hay 15 disponibles para
// mostrador. Por eso esta PROHIBIDO marcar un pedido como preparado si no alcanza
// el stock: la produccion extra que haga falta se carga aparte, a mano, en la
// vista de Produccion (flujo de siempre) antes de poder marcar preparado.
export async function marcarPedidoListo(pedido) {
  const fecha = todayISO();
  const hora = currentTime();
  const now = new Date().toISOString();

  // Chequeo de stock ANTES de tocar el estado: si falta algo, se corta aca y el
  // pedido se queda en "pendiente" hasta que se cargue mas produccion.
  await withStores(["productos"], "readonly", async (stores) => {
    const faltantes = [];
    for (const item of pedido.items) {
      const product = await requestToPromise(stores.productos.get(item.productId));
      if (!product) {
        faltantes.push(`No se encontro el producto "${item.nombre}".`);
        continue;
      }
      if (product.controlaStock && product.stockActual < item.cantidad) {
        faltantes.push(`${product.nombre}: hay ${product.stockActual}, se necesitan ${item.cantidad}.`);
      }
    }
    if (faltantes.length > 0) {
      throw new Error(`Falta stock para preparar este pedido. Carga produccion antes de marcar preparado. ${faltantes.join(" ")}`);
    }
  });

  const ok = await patchEstadoPedido(pedido.id, "listo", "pendiente", { listo_en: now });
  if (!ok) throw new Error("Este pedido ya fue marcado como listo.");

  return withStores(["productos", "ventas", "detalle_venta", "movimientos_stock"], "readwrite", async (stores) => {
    const lines = [];
    let computedTotalCentavos = 0;

    for (const item of pedido.items) {
      const product = await requestToPromise(stores.productos.get(item.productId));
      lines.push({ product, quantity: item.cantidad, unitPrice: item.precioUnitarioCentavos });
      computedTotalCentavos += item.precioUnitarioCentavos * item.cantidad;
    }

    // El precio del pedido puede haberse editado a mano (promos fuera del sistema),
    // asi que la venta registra ese total real, no la suma de catalogo.
    const totalCentavos = Number.isFinite(pedido.totalCentavos) ? pedido.totalCentavos : computedTotalCentavos;
    const ajusteCentavos = totalCentavos - computedTotalCentavos;

    const saleId = await requestToPromise(
      stores.ventas.add({
        fecha, hora, totalCentavos, saleMode: "normal", creadoEn: now,
        origen: "pedido",
        pedidoId: pedido.id,
        clienteNombre: pedido.clienteNombre
      })
    );

    const _detallesSync = [];
    const _movStockSync = [];

    for (const line of lines) {
      const detalle = {
        ventaId: saleId,
        productoId: line.product.id,
        productoNombre: line.product.nombre,
        cantidad: line.quantity,
        precioUnitarioCentavos: line.unitPrice,
        subtotalCentavos: line.unitPrice * line.quantity,
        fecha,
        creadoEn: now,
        origen: "pedido",
        pedidoId: pedido.id
      };
      stores.detalle_venta.add(detalle);
      _detallesSync.push(detalle);

      if (line.product.controlaStock) {
        const stockAnterior = line.product.stockActual;
        const stockNuevo = Math.max(0, stockAnterior - line.quantity);
        stores.productos.put({ ...line.product, stockActual: stockNuevo, actualizadoEn: now });
        const mov = {
          productoId: line.product.id,
          tipo: "venta",
          cantidad: -line.quantity,
          stockAnterior,
          stockNuevo,
          referencia: `Pedido #${pedido.id}`,
          fecha,
          creadoEn: now
        };
        stores.movimientos_stock.add(mov);
        _movStockSync.push(mov);
      }
    }

    if (ajusteCentavos !== 0) {
      const ajuste = {
        ventaId: saleId,
        productoId: `ajuste-pedido-${pedido.id}`,
        productoNombre: "Ajuste de precio (promo)",
        cantidad: 1,
        precioUnitarioCentavos: ajusteCentavos,
        subtotalCentavos: ajusteCentavos,
        fecha,
        creadoEn: now,
        origen: "pedido",
        pedidoId: pedido.id
      };
      stores.detalle_venta.add(ajuste);
      _detallesSync.push(ajuste);
    }

    return {
      _syncPayload: {
        venta: { fecha, hora, totalCentavos, saleMode: "normal", creadoEn: now },
        detalles: _detallesSync,
        movimientosStock: _movStockSync
      }
    };
  });
}

// Solo cambia el estado — el stock ya se descontó al marcar "preparado".
export async function marcarPedidoEntregado(pedidoId) {
  const ok = await patchEstadoPedido(pedidoId, "entregado", "listo", { entregado_en: new Date().toISOString() });
  if (!ok) throw new Error("Este pedido ya fue entregado.");
}
