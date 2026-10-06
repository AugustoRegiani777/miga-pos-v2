// Cuentas del cierre de caja (puras, sin red ni IndexedDB).
//
// La idea: la tarjeta se cierra en Postnet y ese total se anota a mano; el
// efectivo NO se registra venta por venta, se deduce por resta:
//
//   efectivo de ventas = ventas del sistema
//                        - paquetes Too Good To Go (si los cobra la app, no entran al cajon)
//                        - tarjeta (cierre de Postnet)
//                        - plataformas (Glovo, etc.: cobra la plataforma)
//   esperado en cajon  = fondo inicial + efectivo de ventas - retiros
//   diferencia         = contado - esperado      (negativo = falta plata)
//
// Todo en centavos enteros: nunca se suman decimales.

// "12,50" / "12.5" / "1.234,50" / "12" -> 1250. Vacio -> null. Invalido (o negativo) -> NaN.
export function parseEuros(texto) {
  const limpio = String(texto ?? "").replace(/[€\s]/g, "");
  if (limpio === "") return null;
  let normal = limpio;
  if (limpio.includes(",")) normal = limpio.replace(/\./g, "").replace(",", "."); // 1.234,50
  else if ((limpio.match(/\./g) || []).length > 1) normal = limpio.replace(/\./g, ""); // 1.234.567
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return NaN;
  return Math.round(Number(normal) * 100);
}

const suma = (lista, f) => lista.reduce((total, x) => total + f(x), 0);

// ventas: [{ totalCentavos, saleMode }] ya sin anuladas.
export function calcularCierre({
  ventas,
  fondoCentavos = 0,
  tarjetaCentavos = 0,
  plataformasCentavos = 0,
  retirosCentavos = 0,
  contadoCentavos = null,
  fondoMananaCentavos = null,
  tgtgEnCajon = false
}) {
  const ventasTotalCentavos = suma(ventas, (v) => v.totalCentavos || 0);
  const tgtgCentavos = suma(ventas.filter((v) => v.saleMode === "togoo"), (v) => v.totalCentavos || 0);
  const tgtgFueraDelCajon = tgtgEnCajon ? 0 : tgtgCentavos;

  const efectivoDeVentasCentavos = ventasTotalCentavos - tgtgFueraDelCajon - tarjetaCentavos - plataformasCentavos;
  const esperadoEfectivoCentavos = fondoCentavos + efectivoDeVentasCentavos - retirosCentavos;
  const diferenciaCentavos = contadoCentavos === null ? null : contadoCentavos - esperadoEfectivoCentavos;

  const alertas = [];
  if (efectivoDeVentasCentavos < 0) {
    alertas.push("Tarjeta y plataformas suman más de lo que vendió el sistema: revisá los importes.");
  }
  if (esperadoEfectivoCentavos < 0) {
    alertas.push("El efectivo esperado da negativo: revisá fondo, tarjeta y retiros.");
  }
  if (contadoCentavos !== null && fondoMananaCentavos !== null && fondoMananaCentavos > contadoCentavos) {
    alertas.push("Querés dejar para mañana más efectivo del que contaste.");
  }

  let nivel = null; // null = todavia sin contar
  if (diferenciaCentavos !== null) nivel = diferenciaCentavos === 0 ? "ok" : Math.abs(diferenciaCentavos) <= 100 ? "chico" : "grande";

  return {
    ventasTotalCentavos,
    tickets: ventas.length,
    tgtgCentavos,
    tgtgFueraDelCajon,
    efectivoDeVentasCentavos,
    esperadoEfectivoCentavos,
    diferenciaCentavos,
    nivel,
    // lo que sale del cajon esta noche = contado - lo que queda de fondo para manana
    retiraCentavos: contadoCentavos !== null && fondoMananaCentavos !== null ? contadoCentavos - fondoMananaCentavos : null,
    alertas
  };
}

// De varios cierres del mismo dia, el vigente es el mas reciente (los demas son
// historial: un cierre nunca se edita, se reemplaza por otro).
export function cierresVigentesPorFecha(cierres) {
  const porFecha = new Map();
  for (const c of cierres) {
    const actual = porFecha.get(c.fecha);
    if (!actual || String(c.creadoEn) > String(actual.creadoEn)) porFecha.set(c.fecha, c);
  }
  return [...porFecha.values()].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

export function versionesDeFecha(cierres, fecha) {
  return cierres.filter((c) => c.fecha === fecha).sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn)));
}

// 1250 -> "12,50" (para rellenar un campo de texto)
export function centavosAInput(centavos) {
  if (centavos === null || centavos === undefined) return "";
  return (centavos / 100).toFixed(2).replace(".", ",");
}

// Como se cobro cada venta segun lo que se tapeo en la Caja (efectivo/tarjeta,
// ver migracion 016) — puramente informativo, para comparar contra lo que se
// carga a mano del cierre de Postnet. Nunca reemplaza ese numero: el ticket
// de Postnet es la fuente de verdad de cuanto entro realmente por tarjeta
// (la Caja puede tener un toque equivocado); esto solo ayuda a detectarlo.
export function desgloseFormaPago(ventas) {
  const suma = (forma) => ventas
    .filter((v) => (v.formaPago || "efectivo") === forma)
    .reduce((total, v) => total + (v.totalCentavos || 0), 0);
  return { efectivoCentavos: suma("efectivo"), tarjetaCentavos: suma("tarjeta") };
}
