import { getOne, withStores } from "../db/idb.js";
import { consultarNovedades, AREAS } from "../db/novedades-remoto.js";

// "Novedades" = cambios que hizo OTRO dispositivo y este todavia no bajo.
// Es el espejo del badge de sincronizacion que ya existe: aquel cuenta lo que
// falta SUBIR, este lo que falta BAJAR.
//
// Por que no se bajan solas: en la tablet, el catalogo no puede cambiar a
// mitad de una venta (un precio distinto al que muestra la pantalla). Asi que
// esto solo avisa; traerlas sigue siendo un toque del usuario.

const CURSORES_ID = "novedades_cursores";

async function leerCursores() {
  const row = await getOne("configuracion", CURSORES_ID);
  return row?.valor || {};
}

async function guardarCursores(cursores) {
  await withStores(["configuracion"], "readwrite", (stores) => {
    stores.configuracion.put({ id: CURSORES_ID, valor: cursores, actualizadoEn: new Date().toISOString() });
  });
}

// Arma el texto corto del aviso. Si cambio una sola cosa, dice QUE cambio; si
// cambiaron varias, el total. La idea es que "3 cambios en el menú" diga mas
// que "actualizar catálogo", que no dice nada.
export function textoNovedades(conteos) {
  const conCambios = Object.entries(conteos).filter(([, n]) => n > 0);
  if (conCambios.length === 0) return "";
  const total = conCambios.reduce((suma, [, n]) => suma + n, 0);

  if (conCambios.length === 1) {
    const [area, n] = conCambios[0];
    if (area === "pedidos") return n === 1 ? "1 pedido nuevo" : `${n} pedidos nuevos`;
    return `${n} ${n === 1 ? "cambio" : "cambios"} en ${AREAS[area].etiqueta}`;
  }
  return `${total} cambios`;
}

// Primera vez en este dispositivo: se guardan los cursores en el estado
// actual y no se avisa nada. Sin esto, un dispositivo nuevo abriria diciendo
// "107 cambios" — todo el catalogo, que en realidad ya tiene.
export async function inicializarNovedadesSiHaceFalta() {
  const cursores = await leerCursores();
  if (Object.keys(cursores).length > 0) return;
  const resultado = await consultarNovedades({});
  const nuevos = {};
  const ahora = new Date().toISOString();
  for (const [area, { cursorNuevo }] of Object.entries(resultado)) {
    // Un area sin ninguna fila todavia (ej. pedidos en un local nuevo) no
    // tiene fecha de la cual partir. Se usa "ahora": sin esto el cursor queda
    // en null y, apenas aparezca la primera fila, contaria TODAS como nuevas.
    nuevos[area] = cursorNuevo || ahora;
  }
  await guardarCursores(nuevos);
}

// Devuelve { conteos: {menu, insumos, pedidos}, total, texto }.
// Los cursores NO se mueven aca: recien se mueven cuando el usuario trae los
// cambios (ver marcarNovedadesTraidas). Si se movieran al consultar, el aviso
// se borraria solo sin que nadie haya bajado nada.
export async function revisarNovedades() {
  const cursores = await leerCursores();
  const resultado = await consultarNovedades(cursores);
  const conteos = {};
  const cursoresNuevos = {};
  for (const [area, { cantidad, cursorNuevo }] of Object.entries(resultado)) {
    conteos[area] = cantidad;
    cursoresNuevos[area] = cursorNuevo;
  }
  const total = Object.values(conteos).reduce((suma, n) => suma + n, 0);
  return { conteos, total, texto: textoNovedades(conteos), cursoresNuevos };
}

// Se llama despues de un pull exitoso: a partir de aca, todo lo que habia
// quedo bajado y el aviso vuelve a cero.
export async function marcarNovedadesTraidas(cursoresNuevos) {
  if (!cursoresNuevos) return;
  const cursores = await leerCursores();
  await guardarCursores({ ...cursores, ...cursoresNuevos });
}
