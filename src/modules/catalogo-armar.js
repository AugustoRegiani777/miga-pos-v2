// Armar las piezas del catalogo: insumo, linea de proveedor, espejo de reventa.
//
// PURO: sin base de datos, sin red, sin pantalla. Por eso se puede probar sin
// navegador (ver catalogo-armar.test.mjs). Guardarlas y enviarlas a la nube es
// cosa de catalogo-guardar.js.
//
// Todas las puertas que crean cosas del catalogo (Insumo suelto, Cargar factura,
// Proveedores, Menu, Variantes) arman con ESTAS funciones. Antes cada una tenia
// su propia version, y eso se pago caro: un insumo con minimo 0 que nunca pedia
// reposicion, y una linea de proveedor armada distinto segun la puerta.

import { slugify } from "../utils/format.js";

const numero = (v) => {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const positivo = (v) => {
  const n = numero(v);
  return n > 0 ? n : null;
};

// ---------------------------------------------------------------------------
// Insumo
// ---------------------------------------------------------------------------

// Punto unico para "armar un insumo nuevo". idsUsados se pasa por referencia y
// esta funcion lo va completando: si se crean varios insumos nuevos en el mismo
// lote (ej. dos lineas de receta nuevas en un mismo producto), el segundo no
// puede colisionar con el id que acaba de resolver el primero.
export function construirInsumoNuevo(nombre, idsUsados, { unidad, unidadCompra, factorConversion, stockMinimo, stockCritico } = {}) {
  const nombreLimpio = String(nombre || "").trim();
  if (!nombreLimpio) throw new Error("El nombre del insumo nuevo es obligatorio.");

  let id = slugify(nombreLimpio);
  let sufijo = 2;
  while (idsUsados.has(id)) {
    id = `${slugify(nombreLimpio)}-${sufijo}`;
    sufijo += 1;
  }
  idsUsados.add(id);

  const now = new Date().toISOString();
  const unidadFinal = String(unidad || "").trim() || "unidad";

  // El envase: con que nombre lo contas y cuanto trae cada uno. Sin envase
  // propio, el insumo se cuenta en su unidad base (factor 1). Un envase que
  // traiga 1 o menos no es un envase, asi que tampoco cuenta.
  const envaseNombre = String(unidadCompra || "").trim();
  const envaseTrae = numero(factorConversion);
  const tieneEnvase = Boolean(envaseNombre) && Number.isFinite(envaseTrae) && envaseTrae > 1;

  // Un minimo en 0 NO es un minimo: es un insumo que nunca va a pedir
  // reposicion y que ademas se muestra en rojo "critico" para siempre, porque
  // cualquier stock es <= 0. Le paso al salami y a la "lengua carne": se dejaban
  // los campos vacios y un `|| 0` los convertia en cero sin avisar.
  //
  // Cuando no viene un numero se pone un piso razonable segun la unidad —un
  // kilo, un litro, una docena— que es un mal dato pero visible y corregible, a
  // diferencia del cero, que es un mal dato invisible.
  const minimoFinal = positivo(stockMinimo) ?? PISO_MINIMO[unidadFinal] ?? 1;
  const criticoFinal = positivo(stockCritico) ?? Math.round((minimoFinal / 2) * 100) / 100;

  return {
    id,
    nombre: nombreLimpio,
    unidad: unidadFinal,
    unidadCompra: tieneEnvase ? envaseNombre : unidadFinal,
    factorConversion: tieneEnvase ? envaseTrae : 1,
    stockActual: 0,
    stockMinimo: minimoFinal,
    stockCritico: criticoFinal,
    activo: true,
    creadoEn: now,
    actualizadoEn: now
  };
}

const PISO_MINIMO = { g: 1000, ml: 1000, unidad: 12, rebanada: 24 };

// El minimo que se PROPONE al crear un insumo desde la receta de un producto:
// nadie sabe de memoria cuantos gramos de lengua quiere tener siempre, pero
// todos saben que hacen unos 50 sandwiches de ese tipo antes de reponer.
// cantidad x 50, redondeado a algo que se lea (1500, no 1487,5).
export const UNIDADES_ANTES_DE_REPONER = 50;
export function minimoSugerido(cantidadPorUnidad) {
  const n = positivo(cantidadPorUnidad);
  if (!n) return null;
  const crudo = n * UNIDADES_ANTES_DE_REPONER;
  const paso = crudo >= 1000 ? 100 : crudo >= 100 ? 10 : 1;
  return Math.max(paso, Math.round(crudo / paso) * paso);
}

// ---------------------------------------------------------------------------
// Linea de proveedor: "este proveedor me vende este insumo, asi, a este precio"
// ---------------------------------------------------------------------------

// El precio entra de una de dos maneras, segun de donde venga el dato:
//   precio                  en euros, tal como se tipea ("17,19")
//   precioUnitarioCentavos  ya en centavos (lo que ya calcula una factura)
export function construirLineaProveedor(
  { id, proveedorId, insumoId, nombreProducto, unidadCompra, cantidadPorUnidad, precio, precioUnitarioCentavos },
  now = new Date().toISOString()
) {
  const centavos = precioUnitarioCentavos ?? Math.round((positivo(precio) ?? 0) * 100);
  return {
    id: id ?? `${proveedorId}:${insumoId}`,
    proveedorId,
    insumoId,
    nombreProducto: String(nombreProducto ?? "").trim(),
    unidadCompra: String(unidadCompra ?? "").trim(),
    cantidadPorUnidad: numero(cantidadPorUnidad),
    precioUnitarioCentavos: centavos,
    activo: true,
    creadoEn: now,
    actualizadoEn: now
  };
}

// ¿Esta linea sirve? Sin proveedor, sin cuanto trae o sin precio la lista de
// compras no puede ni comparar ni calcular: seria una linea que ensucia sin
// servir. Si un formulario la deja incompleta se ignora, y el insumo queda
// "sin proveedor", que es justo lo que Insumos > Completar ya muestra.
export function lineaProveedorCompleta({ proveedorId, unidadCompra, cantidadPorUnidad, precio }) {
  return Boolean(String(proveedorId ?? "").trim())
    && Boolean(String(unidadCompra ?? "").trim())
    && positivo(cantidadPorUnidad) !== null
    && positivo(precio) !== null;
}

// ---------------------------------------------------------------------------
// "Se compra hecho": el producto es, a la vez, su propio insumo
// ---------------------------------------------------------------------------

// Un producto que se compra hecho y se vende tal cual (la Coca-Cola, la medialuna
// que trae Messialuncitas) tiene UN insumo con el mismo id que el producto y una
// receta de una unidad. No es un camino nuevo — es la misma maquinaria de
// siempre (receta -> insumo -> proveedor), y es lo que lo hace entrar en la lista
// de compras con su proveedor y su precio.
//
// El insumo se cuenta en unidades sueltas; cuantas trae una caja lo dice la linea
// de proveedor, no el insumo (CLAUDE.md 7: el envase del insumo y como lo vende
// el proveedor son dos cosas distintas y no se mezclan).
//
// Si el insumo ya existe se REACTIVA en vez de crear otro: su historial de stock
// vive en el ledger y tiene que seguir siendo el mismo.
export function construirEspejoReventa({ producto, datos = {}, insumoExistente = null, now = new Date().toISOString() }) {
  const insumo = insumoExistente
    ? { ...insumoExistente, activo: true, actualizadoEn: now }
    : { ...construirInsumoNuevo(producto.nombre, new Set(), { unidad: "unidad" }), id: producto.id };
  const receta = {
    id: `${producto.id}:${producto.id}`,
    productoId: producto.id,
    insumoId: insumo.id,
    cantidadPorUnidad: 1,
    esEstimado: false,
    creadoEn: now,
    actualizadoEn: now
  };
  const lineaProveedor = lineaProveedorCompleta(datos)
    ? construirLineaProveedor({ ...datos, insumoId: insumo.id }, now)
    : null;
  return { insumo, receta, lineaProveedor };
}
