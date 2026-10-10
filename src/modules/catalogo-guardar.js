// Guardar piezas del catalogo y mandarlas a la nube, en el orden correcto.
//
// UN solo lugar para esto. Las cinco puertas que crean cosas del catalogo
// (Insumo suelto, Cargar factura, Proveedores, Menu, Variantes) armaban a mano
// "escribir en IndexedDB y despues encolar los envios", cada una con su propio
// orden. Y el orden se equivoco tres veces, cada vez en un lugar distinto: la
// linea de proveedor llegaba a Supabase antes que el proveedor o el insumo que
// referencia, la base la rechazaba con un 409 por la clave foranea, y el badge de
// sync quedaba en rojo en una operacion perfectamente normal.
//
// LA REGLA que hace falta saber, y por que funciona:
//
//   tryNow() (sync.js) encola de forma SINCRONICA y recien despues espera la red.
//   El drenado de la cola ordena por nivel (TIER: catalogo, proveedores e insumos
//   primero; recetas y lineas de proveedor despues), pero solo entre lo que YA
//   esta en la cola cuando arranca. Si entre un envio y otro hay un `await` (por
//   ejemplo leer otra tabla), el primer drenado arranca solo con lo primero que se
//   encolo, y si eso era el hijo, sale antes que su padre.
//
//   Entonces: LEER todo primero, y ENCOLAR todo de una vez, sin esperar la red
//   entre un envio y otro. Asi el primer drenado ya los ve a todos y los ordena.
//   Y como no se espera la red, la pantalla nunca queda colgada por un wifi malo
//   (CLAUDE.md 8.4: la UI no espera a Supabase).
//
// Esta funcion NO decide que se guarda: eso lo arma cada puerta con
// catalogo-armar.js. Solo lo escribe, y lo envia bien.

import { getAll, withStores } from "../db/idb.js";
import {
  trySyncCatalogoSnapshot,
  trySyncProveedoresSnapshot,
  trySyncInsumosSnapshot,
  trySyncRecetasSnapshot,
  trySyncProveedorInsumosSnapshot,
  trySyncMovimientosInsumos,
  trySyncRecetaEliminada
} from "./sync.js";

// paquete:
//   productos, proveedores, insumos, recetas, lineasProveedor
//                    -> registros a escribir (put: crea o pisa)
//   movimientosInsumos
//                    -> compras al ledger de insumos (append: nunca se pisa)
//   recetasABorrar   -> ids de lineas de receta que se sacaron
//
// Devuelve { envio }: una promesa que resuelve cuando termino cada intento de
// envio. Casi nadie la espera (queda en la cola y sale sola); sirve para las
// pruebas y para quien necesite saber que ya llego.
export async function guardarCatalogo({
  productos = [],
  proveedores = [],
  insumos = [],
  recetas = [],
  lineasProveedor = [],
  movimientosInsumos = [],
  recetasABorrar = []
} = {}) {
  const stores = [];
  if (productos.length) stores.push("productos");
  if (proveedores.length) stores.push("proveedores");
  if (insumos.length) stores.push("insumos");
  if (recetas.length || recetasABorrar.length) stores.push("recetas");
  if (lineasProveedor.length) stores.push("proveedor_insumos");
  if (movimientosInsumos.length) stores.push("movimientos_insumos");
  if (stores.length === 0) return { envio: Promise.resolve([]) };

  // Todo en UNA transaccion: o queda guardado el paquete entero o nada.
  // (Sin `await` adentro: CLAUDE.md 8.1.)
  await withStores(stores, "readwrite", (s) => {
    for (const x of productos) s.productos.put(x);
    for (const x of proveedores) s.proveedores.put(x);
    for (const x of insumos) s.insumos.put(x);
    for (const id of recetasABorrar) s.recetas.delete(id);
    for (const x of recetas) s.recetas.put(x);
    for (const x of lineasProveedor) s.proveedor_insumos.put(x);
    for (const x of movimientosInsumos) s.movimientos_insumos.add(x);
  });

  // 1) LEER todo lo que hay que mandar. Los snapshots son la tabla ENTERA, no
  //    solo lo nuevo: asi es como esta hecho el sync y asi se evita que dos
  //    dispositivos se pisen por mandar un pedazo.
  const [categorias, todosProductos, todosProveedores, todosInsumos, todasRecetas, todasLineas] = await Promise.all([
    productos.length ? getAll("categorias") : null,
    productos.length ? getAll("productos") : null,
    proveedores.length ? getAll("proveedores") : null,
    insumos.length ? getAll("insumos") : null,
    recetas.length ? getAll("recetas") : null,
    lineasProveedor.length ? getAll("proveedor_insumos") : null
  ]);

  // 2) ENCOLAR todo de una vez. Sin `await` entre uno y otro. El orden de
  //    abajo es el de los niveles, por prolijidad: la cola lo ordena igual.
  const envios = [];
  const enviar = (promesa) => envios.push(Promise.resolve(promesa).catch(() => false));
  if (productos.length) enviar(trySyncCatalogoSnapshot(categorias, todosProductos));
  if (proveedores.length) enviar(trySyncProveedoresSnapshot(todosProveedores));
  if (insumos.length) enviar(trySyncInsumosSnapshot(todosInsumos));
  if (recetas.length) enviar(trySyncRecetasSnapshot(todasRecetas));
  if (lineasProveedor.length) enviar(trySyncProveedorInsumosSnapshot(todasLineas));
  if (movimientosInsumos.length) enviar(trySyncMovimientosInsumos(movimientosInsumos));
  for (const id of recetasABorrar) enviar(trySyncRecetaEliminada(id));

  return { envio: Promise.all(envios) };
}
