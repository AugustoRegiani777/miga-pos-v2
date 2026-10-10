// Detecta insumos con el ciclo a medio configurar.
//
// Un insumo completo tiene las dos puntas:
//   ENTRADA: alguien a quien comprarselo (proveedor_insumos)
//   SALIDA:  una receta que lo consuma
//
// Si le falta la salida, su stock solo puede subir: nunca se descuenta, asi
// que los avisos de "stock bajo" y la lista de compras mienten sobre el.
// Si le falta la entrada, aparece en la lista de compras sin a quien pedirselo.
//
// Esto no bloquea nada: cargar una factura con la mercaderia en la puerta no
// es momento de ponerse a definir recetas. La deuda queda visible y se salda
// cuando haya tiempo.

// Un producto esta "en prueba" mientras no tiene NINGUNA linea de receta: se
// produce y se vende como cualquier otro, pero no descuenta ningun insumo. No es
// un error ni un estado guardado — se deduce de las recetas, asi que no puede
// quedar desactualizado: en cuanto se define como se consigue, deja de estarlo.
//
// El dueño, probando productos nuevos: "se le podria poner algo como 'producto
// de prueba' a estas situaciones, porque son eso: productos que no estan del
// todo seteados porque se estan probando".
//
// Solo cuentan los que se muestran en caja: uno oculto no molesta a nadie.
export function productosEnPrueba(productos = [], recetas = []) {
  const conReceta = new Set(recetas.map((r) => r.productoId));
  return productos.filter((p) => p.activo !== false && !conReceta.has(p.id));
}

export function revisarCicloInsumos({ insumos, recetas, proveedorInsumos, gruposVariantes = [], productos = [] }) {
  // La salida de un insumo puede venir por dos caminos, no solo por la receta:
  //
  //   1. una linea de receta que lo nombra, o
  //   2. ser OPCION de un grupo de variante.
  //
  // La leche de avena no figura en ninguna receta — la receta del cafe nombra
  // la entera — y sin embargo se consume cada vez que alguien pide su cafe con
  // avena: el grupo la sustituye al cobrar. Mirando solo las recetas, el aviso
  // la daba por "no se usa en ningun producto" y mandaba a inventarle una
  // receta que habria hecho que el cafe descontara DOS leches. Es el mismo
  // error que ya habia metido tres leches en la receta del cafe con leche.
  const conSalida = new Set(recetas.map((r) => r.insumoId));
  for (const grupo of gruposVariantes) {
    for (const opcion of grupo?.opciones || []) {
      if (opcion?.insumoId) conSalida.add(opcion.insumoId);
    }
  }
  const conEntrada = new Set(proveedorInsumos.filter((pi) => pi.activo !== false && pi.insumoId).map((pi) => pi.insumoId));

  const activos = insumos.filter((i) => i.activo !== false);
  const sinSalida = activos.filter((i) => !conSalida.has(i.id));
  const sinEntrada = activos.filter((i) => !conEntrada.has(i.id));

  const enPrueba = productosEnPrueba(productos, recetas);

  return {
    sinSalida,
    sinEntrada,
    enPrueba,
    // Un insumo puede estar en las dos listas; para el conteo interesa cuantos
    // tienen algo pendiente, no la suma de pendientes.
    incompletos: activos.filter((i) => !conSalida.has(i.id) || !conEntrada.has(i.id)),
    completo: sinSalida.length === 0 && sinEntrada.length === 0 && enPrueba.length === 0
  };
}

// Cada pendiente, uno por uno y con lo que hace falta para resolverlo ahi
// mismo. Antes esto devolvia un texto con los nombres y un boton que llevaba a
// otra pantalla a buscarlos: el dato faltante se arregla donde se detecta, no
// donde haya que ir.
export function pendientesDelCiclo(revision) {
  const pendientes = [];
  for (const insumo of revision.sinEntrada) {
    pendientes.push({
      insumoId: insumo.id,
      insumoNombre: insumo.nombre,
      unidad: insumo.unidad,
      falta: "proveedor",
      titulo: "Sin proveedor",
      porQue: "No hay a quién pedírselo, así que no puede entrar en la lista de compras."
    });
  }
  for (const insumo of revision.sinSalida) {
    pendientes.push({
      insumoId: insumo.id,
      insumoNombre: insumo.nombre,
      unidad: insumo.unidad,
      falta: "receta",
      titulo: "No se usa en ningún producto",
      porQue: "Sin receta que lo consuma su stock solo sube, y los avisos de poco stock no sirven para él."
    });
  }
  // Los productos en prueba van DESPUES de los insumos: son menos urgentes (no
  // rompen la lista de compras, solo no descuentan) y el dueño ya sabe que estan.
  for (const producto of revision.enPrueba || []) {
    pendientes.push({
      productoId: producto.id,
      productoNombre: producto.nombre,
      falta: "producto",
      titulo: "En prueba",
      porQue: "Se produce y se vende normal, pero no descuenta ningún insumo. Cuando sepas cómo se consigue, definilo acá."
    });
  }
  return pendientes;
}

export function resumenPendientes(pendientes) {
  if (pendientes.length === 0) return null;
  const productos = pendientes.filter((p) => p.falta === "producto").length;
  const insumos = pendientes.length - productos;
  const partes = [];
  if (insumos > 0) partes.push(insumos === 1 ? "1 insumo a medio configurar" : `${insumos} insumos a medio configurar`);
  if (productos > 0) partes.push(productos === 1 ? "1 producto en prueba" : `${productos} productos en prueba`);
  return partes.join(" · ");
}
