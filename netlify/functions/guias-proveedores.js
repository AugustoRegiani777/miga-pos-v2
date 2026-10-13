// Como se lee la factura (o albaran) de CADA proveedor.
//
// Cada proveedor imprime su documento a su manera: otro orden de columnas, otra manera de
// decir "kilos" o "cajas", numeros de control en lugares que parecen cantidades. La IA lee la
// imagen, pero sin saber como es el documento de ESTE proveedor puede tomar un dato por otro
// (por ejemplo, la cantidad de la fila de abajo, que en realidad son los kilos totales).
//
// Aca se escribe lo que se aprendio de cada proveedor, con la clave del proveedor en la app
// (el id de la tabla proveedores). La funcion procesar-factura.js agrega la guia del proveedor
// elegido al pedido que le hace a la IA. Un proveedor sin guia se lee solo con las reglas
// generales.
//
// COMO AGREGAR O CORREGIR UNA GUIA: editar este archivo (no hace falta tocar nada mas), con:
//   - "documento": como esta organizado el papel (columnas, filas, resumenes).
//   - "reglas": que significa cada dato y cual es la cantidad real.
//   - "ejemplos": lineas reales transcritas, con lo que hay que extraer. Un ejemplo vale mas
//     que una regla: la IA copia el patron.
// Cada guia debe decir en que documento se baso, para saber que tan firme es.

const GUIAS = {
  jasa: {
    nombre: "JASA Alimentacion",
    baseEn: "1 albaran del 21/09/2026 (mortadela y york)",
    documento:
      "Tabla con las columnas: N° (codigo) | DESCRIPCION | CANTIDAD | U.MED | U/UD.MED. | P.V.P | DTO | IMPORTE. " +
      "Cada producto ocupa DOS filas: la primera lleva el codigo, el nombre en negrita y los numeros de las columnas; " +
      "la segunda, en letra chica, lleva datos de control ('F.C.: fecha. Can: numero. Peso: numero. Total: numero. IVA 10 %'). " +
      "Arriba hay una linea de resumen tipo 'Cajas: 1 /Uds: 2 /Kilos: 3 /Total Kilos: 9,300'.",
    reglas: [
      "La cantidad comprada es SIEMPRE la de la columna CANTIDAD de la primera fila del producto. Nunca uses un numero de la segunda fila.",
      "En la segunda fila, 'F.C.' es la FECHA DE CADUCIDAD (ignorala). 'Can:' es la cantidad TOTAL EN KILOS (control), no las unidades compradas. 'Peso:' y 'Total:' tambien son kilos de control.",
      "U.MED dice en que viene la cantidad: 'K' = kilos (el producto se vende por peso: la cantidad ya son kilos); 'U' = unidades (piezas enteras).",
      "U/UD.MED, cuando esta, es lo que pesa CADA unidad, en kilos. El precio P.V.P es por KILO, no por unidad.",
      "IMPORTE = CANTIDAD x (U/UD.MED si existe, si no 1) x P.V.P. Usalo para comprobar que leiste bien cantidad, peso y precio.",
      "Linea en unidades (U) con U/UD.MED: unidad = 'U', cantidad = las unidades, cantidadPorUnidad = U/UD.MED convertido a la unidad base del insumo (3,15 kg = 3150 g).",
      "Linea en kilos (K): unidad = 'K', cantidad = los kilos, cantidadPorUnidad = 1000 si el insumo esta en gramos.",
      "El resumen de arriba sirve de control: 'Uds' es la suma de las lineas en U, 'Kilos' la de las lineas en K y 'Total Kilos' el peso total de todo."
    ],
    ejemplos: [
      {
        factura: "47001580 | MORTADELA ITALIANA C/****kg | CANTIDAD 3 | U.MED K | P.V.P 3,757 | IMPORTE 11,27   (fila 2: F.C.: 22/02/27. Can: 3. Peso: 3,000. Total: 3,000 IVA 10 %)",
        extraer: "cantidad 3, unidad 'K', precio 11.27 (importe de la linea), precioUnitarioFactura 3.757. Son 3 kilos: cantidadPorUnidad 1000 (g). Control: 3 x 3,757 = 11,27."
      },
      {
        factura: "47001610 | YORK BARRA SANDWICH 11x11 Tio D Oro C/****kg | CANTIDAD 2 | U.MED U | U/UD.MED 3,15 | P.V.P 2,900 | IMPORTE 18,27   (fila 2: F.C.: 04/03/27. Can: 6,3. Tio D'Oro IVA 10 %)",
        extraer: "cantidad 2 (NO 6,3), unidad 'U', precio 18.27, precioUnitarioFactura 2.9, factorPorUnidadFactura 3.15. Cada unidad pesa 3,15 kg: cantidadPorUnidad 3150 (g). Control: 2 x 3,15 x 2,90 = 18,27; y 'Can: 6,3' es el peso total (2 x 3,15), no la cantidad."
      }
    ]
  }
};

// Texto que se agrega al pedido a la IA para ese proveedor ("" si no hay guia).
function guiaDe(proveedorId) {
  const g = GUIAS[String(proveedorId || "").toLowerCase()];
  if (!g) return "";
  const reglas = g.reglas.map((r) => `- ${r}`).join("\n");
  const ejemplos = g.ejemplos.map((e, i) => `Ejemplo ${i + 1}\n  En la factura: ${e.factura}\n  Hay que extraer: ${e.extraer}`).join("\n");
  return `\n\nGuia de lectura de las facturas de ${g.nombre} (basada en: ${g.baseEn}):\n${g.documento}\n\nReglas de este proveedor:\n${reglas}\n\n${ejemplos}`;
}

module.exports = { GUIAS, guiaDe };
