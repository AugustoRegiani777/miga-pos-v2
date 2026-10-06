// Calculos puros del modulo Menu — sin IndexedDB, sin red, sin DOM.
// Vive aparte de menu.js justamente para poder probarlo sin navegador
// (ver menu-calculos.test.mjs).

// Que cosas hacen imposible borrar un producto, y como se le dice al usuario.
//
// El orden de las claves es el orden en que aparecen en el mensaje: primero lo
// que el dueño entiende de una (ventas, pedidos), despues el detalle tecnico.
// Cada una existe por un motivo concreto:
//  - ventas: los registros financieros son append-only y auditables (viene la
//    conexion con Hacienda). Una venta vieja nombra a su producto y el panel
//    reconstruye la facturacion desde detalle_venta.
//  - movimientosStock / movimientosInsumos: el ledger del que se deriva el
//    stock y la produccion por dia. Ademas tienen FK sin cascada a
//    productos(id) en Supabase: el DELETE remoto fallaria con un 23503.
//  - pedidosAbiertos: detalle_pedido.producto_id es NOT NULL con FK; borrar el
//    producto dejaria un pedido del cliente imposible de preparar.
export const ETIQUETAS_BLOQUEO = {
  ventas: (n) => `${n} ${n === 1 ? "venta registrada" : "ventas registradas"}`,
  pedidosAbiertos: (n) => `${n} ${n === 1 ? "pedido sin entregar" : "pedidos sin entregar"}`,
  movimientosStock: (n) => `${n} ${n === 1 ? "movimiento" : "movimientos"} de stock (produccion o ajustes)`,
  movimientosInsumos: (n) => `${n} ${n === 1 ? "consumo" : "consumos"} de insumos`
};

export function clasificarBloqueosEliminacion(referencias = {}) {
  return Object.entries(ETIQUETAS_BLOQUEO)
    .filter(([clave]) => Number(referencias[clave]) > 0)
    .map(([clave, etiqueta]) => {
      const cantidad = Number(referencias[clave]);
      return { clave, cantidad, texto: etiqueta(cantidad) };
    });
}

// El mensaje no se queda en "no se puede": dice que hacer en su lugar
// (ocultarlo), porque esa es la accion que el dueño si tiene disponible.
export function mensajeBloqueoEliminacion({ nombre, bloqueos }) {
  const detalle = (bloqueos || []).map((b) => b.texto).join(", ");
  return `"${nombre}" no se puede eliminar: tiene ${detalle}. Borrarlo rompe el historial de ventas y los informes. Desmarca "Mostrar en caja" para sacarlo de la pantalla sin perder esos datos.`;
}

// Texto de la confirmacion. Tiene que dejar dos cosas clarisimas, porque no
// hay papelera ni deshacer: que es definitivo y que recrearlo es volver a
// cargar la receta a mano.
export function mensajeConfirmacionEliminacion({ nombre, lineasReceta = 0, stockActual = 0 }) {
  const avisoReceta = lineasReceta > 0
    ? ` Se borran tambien sus ${lineasReceta} ${lineasReceta === 1 ? "linea" : "lineas"} de receta.`
    : "";
  const avisoStock = stockActual !== 0
    ? ` Ojo: tiene ${stockActual} en stock, ese stock se pierde.`
    : "";
  return `Se borra "${nombre}" de este dispositivo y de la nube.` + avisoReceta + avisoStock +
    " Esto NO se puede deshacer: para volver a tenerlo hay que crearlo de nuevo, con su receta y sus insumos.";
}
