// Que es una "venta directa" y que productos pueden ir en un carrito de Too Good To Go (o darse de baja).
//
// Venta directa: un producto que se compra y se vende hecho (medialunas, bebidas, alfajores, chipa...). No controla
// stock propio: su stock es el de UN insumo que se cuenta por unidad, con receta de 1 a 1.
//
// Too Good To Go (y la baja por desperdicio) son para COMIDA que sobra: sandwiches y bolleria. Antes esto se decidia por
// "tiene stock propio", y quedaban afuera los productos de bolleria que pasaron a venta directa (cinnamon roll, chipa,
// bon o bon, mantecol...): en un carrito ToGoo pedian medio de pago como si fueran un cafe. Ahora cuenta la categoria.
// Las bebidas, el cafe, las promos y el paquete de miga siguen sin entrar.

export function esVentaDirecta(producto, recetas, insumos) {
  if (!producto || producto.controlaStock) return false;
  const lineas = (recetas || []).filter((r) => r.productoId === producto.id);
  if (lineas.length !== 1) return false;
  const [linea] = lineas;
  const insumo = (insumos || []).find((i) => i.id === linea.insumoId);
  return Boolean(insumo) && insumo.unidad === "unidad" && (Number(linea.cantidadPorUnidad) === 1 || linea.insumoId === producto.id);
}

export function admiteToGoo(producto, recetas, insumos) {
  if (!producto) return false;
  if (producto.controlaStock) return true;
  return producto.categoriaId === "bolleria" && esVentaDirecta(producto, recetas, insumos);
}
