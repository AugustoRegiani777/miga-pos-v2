// Calculos puros del Panel (sin red ni IndexedDB): reciben ventas ya normalizadas
// (mismo formato que salesForDay / mapVentaRemota) y devuelven numeros listos
// para mostrar. Separado de panel.js para poder probarlo solo, sin navegador.

const CATEGORIA_SANDWICHES = "sandwiches";

// Lineas sinteticas del detalle: no son productos que se vendieron.
function esLineaSintetica(productoId = "") {
  return productoId === "togoo-fee" || productoId.startsWith("combo-") || productoId.startsWith("ajuste-pedido-");
}

const suma = (lista, f) => lista.reduce((total, x) => total + f(x), 0);

export function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// productosPorId: Map id -> { categoriaId, controlaStock }
export function resumenDelDia(ventas, productosPorId = new Map()) {
  const normales = ventas.filter((v) => (v.saleMode || "normal") === "normal");
  const paquetes = ventas.filter((v) => v.saleMode === "togoo");

  const esSandwich = (d) => {
    const p = productosPorId.get(d.productoId);
    return p?.categoriaId === CATEGORIA_SANDWICHES && p?.controlaStock;
  };
  const lineasNormales = normales.flatMap((v) => v.detalles || []);

  // Docenas / medias docenas: se leen del nombre de la linea de descuento
  // ("Descuento Combo 12 sandwiches", "Descuento 2x Combo 12 sandwiches + Combo 6 sandwiches").
  const combos = { docenas: 0, medias: 0, descuentoCentavos: 0 };
  for (const d of lineasNormales.filter((l) => (l.productoId || "").startsWith("combo-"))) {
    const nombre = d.productoNombre || "";
    const docenas = /(?:(\d+)x\s*)?Combo 12/.exec(nombre);
    const medias = /(?:(\d+)x\s*)?Combo 6/.exec(nombre);
    if (docenas) combos.docenas += Number(docenas[1] || 1);
    if (medias) combos.medias += Number(medias[1] || 1);
    combos.descuentoCentavos += -(d.subtotalCentavos || 0);
  }

  const porHora = Array.from({ length: 24 }, () => ({ tickets: 0, centavos: 0 }));
  for (const v of ventas) {
    const h = parseInt(String(v.hora || "").slice(0, 2), 10);
    if (Number.isInteger(h) && h >= 0 && h < 24) {
      porHora[h].tickets++;
      porHora[h].centavos += v.totalCentavos || 0;
    }
  }
  let pico = null;
  porHora.forEach((b, hora) => { if (b.tickets > 0 && (!pico || b.tickets > pico.tickets)) pico = { hora, tickets: b.tickets }; });

  const porProducto = new Map();
  for (const d of lineasNormales.filter((l) => !esLineaSintetica(l.productoId))) {
    const fila = porProducto.get(d.productoId) || { id: d.productoId, nombre: (d.productoNombre || d.productoId).replace(/\s*\([^)]*\)\s*$/, ""), cantidad: 0, centavos: 0 };
    fila.cantidad += d.cantidad || 0;
    fila.centavos += d.subtotalCentavos || 0;
    porProducto.set(d.productoId, fila);
  }
  const top = [...porProducto.values()].sort((a, b) => b.cantidad - a.cantidad || b.centavos - a.centavos);

  return {
    facturacionCentavos: suma(ventas, (v) => v.totalCentavos || 0),
    tickets: ventas.length,
    ticketMedioCentavos: normales.length ? Math.round(suma(normales, (v) => v.totalCentavos || 0) / normales.length) : 0,
    sandwiches: suma(lineasNormales.filter(esSandwich), (d) => d.cantidad || 0),
    paquetes: paquetes.length,
    unidadesEnPaquetes: suma(paquetes.flatMap((v) => v.detalles || []).filter((d) => d.productoId !== "togoo-fee"), (d) => d.cantidad || 0),
    combos,
    porHora,
    pico,
    top
  };
}

// Ultimos `dias` dias terminando en `hasta` (inclusive), del mas viejo al mas nuevo.
export function tendencia(ventas, hasta, dias = 14) {
  const porFecha = new Map();
  for (const v of ventas) {
    const fila = porFecha.get(v.fecha) || { centavos: 0, tickets: 0 };
    fila.centavos += v.totalCentavos || 0;
    fila.tickets++;
    porFecha.set(v.fecha, fila);
  }
  const serie = Array.from({ length: dias }, (_, i) => {
    const fecha = sumarDias(hasta, i - (dias - 1));
    const fila = porFecha.get(fecha);
    return { fecha, centavos: fila?.centavos || 0, tickets: fila?.tickets || 0 };
  });
  const conVentas = serie.filter((d) => d.tickets > 0);
  return {
    serie,
    promedioCentavos: conVentas.length ? Math.round(suma(conVentas, (d) => d.centavos) / conVentas.length) : 0,
    mejor: conVentas.reduce((best, d) => (!best || d.centavos > best.centavos ? d : best), null)
  };
}

// Variacion porcentual (null si no hay base con que comparar).
export function variacionPct(actual, anterior) {
  if (!anterior) return null;
  return Math.round(((actual - anterior) / anterior) * 100);
}

// Insumos que piden atencion, del mas grave al menos grave. Negativo = se
// consumio mas de lo que se cargo: casi siempre falta cargar una factura.
export function alertasInsumos(insumos) {
  const orden = { negativo: 0, critico: 1, bajo: 2 };
  return insumos
    .filter((i) => i.activo !== false)
    .map((i) => {
      const stock = Number(i.stockActual) || 0;
      const estado = stock < 0 ? "negativo" : stock <= (i.stockCritico ?? 0) ? "critico" : stock <= (i.stockMinimo ?? 0) ? "bajo" : null;
      return estado ? { id: i.id, nombre: i.nombre, unidad: i.unidad, stock, estado } : null;
    })
    .filter(Boolean)
    .sort((a, b) => orden[a.estado] - orden[b.estado] || a.nombre.localeCompare(b.nombre));
}
