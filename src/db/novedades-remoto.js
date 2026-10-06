// Consulta "¿que cambio desde que mire por ultima vez?" sin descargar nada.
//
// El truco: una sola consulta por tabla devuelve las DOS cosas que hacen
// falta. Pidiendo `Prefer: count=exact` con `limit=1`, PostgREST contesta el
// total exacto en la cabecera Content-Range (ej. "0-0/7" = 7 cambios) y en el
// cuerpo viene una sola fila: la mas nueva, que sirve de cursor para la
// proxima vez. Una fila de una columna por tabla — medido: ~130 ms.
//
// Esto NO trae los cambios, solo cuenta cuantos hay. Traerlos sigue siendo
// decision del usuario (el boton "Traer cambios"), porque en la tablet el
// catalogo no se puede actualizar solo a mitad de una venta (ver
// sincronizarCatalogoSilencioso en app.js).

import { sbFetchConCuenta } from "./supabase.js";

// Que mirar en cada area. `columna` es la fecha que marca "esto cambio".
export const AREAS = {
  menu: {
    etiqueta: "el menú",
    tablas: [
      { tabla: "productos", columna: "actualizado_en" },
      { tabla: "categorias", columna: "actualizado_en" },
      { tabla: "recetas", columna: "actualizado_en" },
      { tabla: "configuracion_compartida", columna: "actualizado_en" }
    ]
  },
  insumos: {
    etiqueta: "insumos",
    tablas: [
      { tabla: "insumos", columna: "actualizado_en" },
      { tabla: "proveedores", columna: "actualizado_en" },
      { tabla: "proveedor_insumos", columna: "actualizado_en" }
    ]
  },
  pedidos: {
    etiqueta: "pedidos",
    tablas: [
      { tabla: "pedidos", columna: "creado_en" }
    ]
  }
};

// Devuelve { cantidad, masNuevo } para una tabla. `desde` null = primera vez.
async function contarTabla({ tabla, columna }, desde) {
  const filtro = desde ? `&${columna}=gt.${encodeURIComponent(desde)}` : "";
  const { filas, cuenta } = await sbFetchConCuenta(
    `/${tabla}?select=${columna}${filtro}&order=${columna}.desc&limit=1`
  );
  return { cantidad: cuenta ?? 0, masNuevo: filas?.[0]?.[columna] || null };
}

// cursores: { menu: iso|null, insumos: iso|null, pedidos: iso|null }
// Devuelve por area { cantidad, cursorNuevo } — cursorNuevo es lo que hay que
// guardar cuando el usuario decide traer los cambios (no antes: si se guardara
// ahora, el aviso desapareceria sin que nadie haya traido nada).
export async function consultarNovedades(cursores = {}) {
  const nombres = Object.keys(AREAS);
  const resultados = await Promise.all(nombres.map(async (nombre) => {
    const desde = cursores[nombre] || null;
    const porTabla = await Promise.all(AREAS[nombre].tablas.map((t) => contarTabla(t, desde)));
    const cantidad = porTabla.reduce((total, r) => total + r.cantidad, 0);
    const cursorNuevo = porTabla
      .map((r) => r.masNuevo)
      .filter(Boolean)
      .sort()
      .pop() || desde;
    return [nombre, { cantidad, cursorNuevo }];
  }));
  return Object.fromEntries(resultados);
}
