// Demanda ya conocida: los encargos de clientes traducidos a insumos por fecha.
//
// El stock de insumos hoy se juzga contra un numero fijo (stockMinimo), que no
// sabe nada de lo que ya esta vendido. Si hay tres pedidos grandes para el
// sabado, el jamon no esta "bajo": esta vendido. Este modulo convierte esos
// encargos en kilos/gramos/rebanadas por dia, para que la lista de compras
// pueda decir "no llego hasta el proximo pedido" en vez de "stock bajo".
//
// Calculo puro: no toca IDB, ni red, ni el reloj del sistema. Las fechas entran
// como strings YYYY-MM-DD y se comparan como strings (la app corre con reloj
// simulado; cualquier cosa atada a new Date() local se vuelve infiable).
//
// Entrada:
//   pedidos:    [{ id, estado, fechaHoraRetiro, items: [{ productId, cantidad }] }]
//               `estado` real en el schema: "pendiente" | "listo" | "entregado".
//               Los items vienen de mapPedidoRow (pedidos.js) con la clave
//               `productId`; se acepta tambien `productoId` por si el pedido
//               llega armado desde un formulario.
//   recetas:    [{ productoId, insumoId, cantidadPorUnidad }]  (unidad base del insumo)
//   hoy:        "YYYY-MM-DD"  — primer dia de la ventana, inclusive
//   hastaFecha: "YYYY-MM-DD"  — ultimo dia de la ventana, inclusive
//
// Salida:
//   {
//     [insumoId]: {
//       porFecha: { "YYYY-MM-DD": cantidadEnUnidadBase, ... },
//       total:    cantidadEnUnidadBase  // suma de porFecha
//     }
//   }
//   Un insumo sin demanda en la ventana no aparece en el objeto.
//
// Reglas (cada una con su motivo):
//  1. Solo `estado === "pendiente"`. Un pedido marcado preparado ("listo") ya
//     descontó su stock en marcarPedidoListo(); contarlo de nuevo seria doble
//     conteo. "entregado" ya paso por "listo", lo mismo.
//  2. Solo entre `hoy` y `hastaFecha`, ambos inclusive.
//  3. Un pedido con fecha pasada y todavia pendiente cuenta en `hoy`: esa
//     demanda sigue existiendo, el cliente no vino todavia.
//  4. Un producto sin receta no aporta nada y no rompe (bolleria comprada
//     hecha, por ejemplo).
//
// Lo que NO hace, a proposito: no resuelve variantes (la leche de un cafe).
// Los items de pedido no guardan `opcionNombre`, asi que no hay nada que
// resolver; si algun dia lo guardan, el enganche es resolverLineaEfectiva().

const soloFecha = (valor) => String(valor || "").slice(0, 10);

const esFechaISO = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(valor);

// Las recetas tienen 4 decimales (ver crearLineaReceta): sumar 0.5 rebanadas
// muchas veces deja colas de punto flotante que despues se imprimen en pantalla.
const redondear = (n) => Math.round(n * 10000) / 10000;

// Indexa recetas por producto una sola vez: un pedido con 10 items no deberia
// recorrer la tabla de recetas 10 veces.
function agruparRecetasPorProducto(recetas) {
  const porProducto = new Map();
  for (const receta of recetas || []) {
    if (!receta || !receta.productoId || !receta.insumoId) continue;
    const cantidad = Number(receta.cantidadPorUnidad);
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    const lista = porProducto.get(receta.productoId) || [];
    lista.push({ insumoId: receta.insumoId, cantidadPorUnidad: cantidad });
    porProducto.set(receta.productoId, lista);
  }
  return porProducto;
}

export function demandaConocidaPorInsumo({ pedidos, recetas, hoy, hastaFecha } = {}) {
  const desde = soloFecha(hoy);
  const hasta = soloFecha(hastaFecha);
  if (!esFechaISO(desde) || !esFechaISO(hasta) || hasta < desde) return {};

  const recetasPorProducto = agruparRecetasPorProducto(recetas);
  const resultado = {};

  for (const pedido of pedidos || []) {
    if (!pedido || pedido.estado !== "pendiente") continue;

    const fechaPedido = soloFecha(pedido.fechaHoraRetiro);
    if (!esFechaISO(fechaPedido)) continue;
    if (fechaPedido > hasta) continue;
    // Regla 3: lo vencido y pendiente se imputa al primer dia de la ventana.
    const fecha = fechaPedido < desde ? desde : fechaPedido;

    for (const item of pedido.items || []) {
      if (!item) continue;
      const productoId = item.productId || item.productoId;
      const cantidad = Number(item.cantidad);
      if (!productoId || !Number.isFinite(cantidad) || cantidad <= 0) continue;

      const lineas = recetasPorProducto.get(productoId);
      if (!lineas) continue; // Regla 4: producto sin receta, no aporta.

      for (const linea of lineas) {
        const consumo = linea.cantidadPorUnidad * cantidad;
        const entrada = resultado[linea.insumoId] || (resultado[linea.insumoId] = { porFecha: {}, total: 0 });
        entrada.porFecha[fecha] = redondear((entrada.porFecha[fecha] || 0) + consumo);
        entrada.total = redondear(entrada.total + consumo);
      }
    }
  }

  return resultado;
}

// Cuanto de este insumo esta ya comprometido entre hoy y hastaFecha.
// Atajo para el caso mas comun (un solo insumo, una sola cifra).
export function demandaTotalDeInsumo(demanda, insumoId) {
  return demanda && demanda[insumoId] ? demanda[insumoId].total : 0;
}
