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
  "jet-extramar": {
    nombre: "Jet Extramar",
    baseEn: "4 facturas de septiembre 2026 (01/09, 15/09, 21/09 y 28/09: gouda, brie, paleta york, aceitunas, crema de queso, pollo, potro, pan rallado)",
    documento:
      "Ticket angosto con la columna ARTICULO / LOTE | CANTIDAD | PRECIO | DTO | BRUTO. " +
      "Cada producto ocupa DOS lineas: la primera lleva el codigo y el nombre ('922 BARRA GOUDA ALEMANA 4UDX3KG APROX P.V.'); " +
      "la segunda lleva 'L/ numero' (el lote) y, en la misma linea, la cantidad, el precio y el bruto. " +
      "El comprador (arriba, 'PALATNIK SHARON LEILA', CIF Z2054758N, Calle Llop 1) es Uno de Miga, NO el proveedor. " +
      "Abajo: BASE IMPONIBLE, el IVA desglosado (10 % y 4 %) y TOTAL FACTURA.",
    reglas: [
      "La cantidad es la de la columna CANTIDAD, con su unidad pegada: 'KG' = kilos, 'BL' = bote/bolsa, 'BT' = bote. 'L/ 262627' es el LOTE: nunca es una cantidad.",
      "Los productos 'P.V.' (peso variable, 'APROX') se facturan por kilo REAL: la cantidad son los kilos de la columna CANTIDAD (ej. 6,08 KG) y el PRECIO es por kilo. El peso del nombre ('4UDX3KG') es solo el formato aproximado de la pieza: no lo uses como cantidad.",
      "BRUTO = CANTIDAD x PRECIO. Usalo para comprobar la lectura (6,08 x 4,95 = 30,10).",
      "En la columna BRUTO a veces aparece la palabra 'OFERTA' (precio de oferta): ignorala, el importe de la linea es el numero.",
      "Un asterisco '*' al final de la linea marca IVA 4 % (lacteos, pan). No cambia la cantidad ni el importe: ignoralo.",
      "El codigo del principio ('922', '197', '4', '1119') es el codigo interno del proveedor; sirve para reconocer el mismo producto entre facturas, no es una cantidad.",
      "'1119 RODAJAS ACEITUNA VERDE 10X936ESC' se vende por BL (bote): la cantidad son los botes (2,00 BL = 2) y el formato '10X936' NO es la cantidad. No inventes los gramos por bote: si el insumo no lo define, dejalo para que la persona lo confirme.",
      "'713 CREMA QUESO SNEL 1 BOTEX2KG': se vende por BT (bote) de 2 kg: cantidad 1, cantidadPorUnidad 2000 (g).",
      "Las anotaciones a mano (por ejemplo 'Uno de Miga') y los datos de pago no son lineas."
    ],
    ejemplos: [
      {
        factura: "922 BARRA GOUDA ALEMANA 4UDX3KG APROX P.V. | L/ 262627 | 6,08 KG | 4,95 | 30,10 *",
        extraer: "cantidad 6.08, unidad 'KG', precio 30.10 (importe), precioUnitarioFactura 4.95. Son kilos: cantidadPorUnidad 1000 (g). Control: 6,08 x 4,95 = 30,10."
      },
      {
        factura: "4 PALETA YORK 11X11 JET (3UDS) P.V. | L/ 263192 | 8,91 KG | 4,25 | 37,87",
        extraer: "cantidad 8.91, unidad 'KG', precio 37.87, precioUnitarioFactura 4.25. Control: 8,91 x 4,25 = 37,87."
      },
      {
        factura: "1119 RODAJAS ACEITUNA VERDE 10X936ESC | L/ 262366 | 2,00 BL | 4,60 | 9,20",
        extraer: "cantidad 2, unidad 'BL', precio 9.20, precioUnitarioFactura 4.6. Control: 2 x 4,60 = 9,20."
      },
      {
        factura: "713 CREMA QUESO SNEL 1 BOTEX2KG | L/ 263496 | 1,00 BT | 11,60 | 11,60 *",
        extraer: "cantidad 1, unidad 'BT', precio 11.60, precioUnitarioFactura 11.6. El bote trae 2 kg: cantidadPorUnidad 2000 (g)."
      }
    ]
  },
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

// El id lo genera la app a partir del nombre que se escribe: se aceptan las variantes habituales.
GUIAS.jet = GUIAS["jet-extramar"];
GUIAS.jetextramar = GUIAS["jet-extramar"];
GUIAS["jet-extramar-sa"] = GUIAS["jet-extramar"];

// Texto que se agrega al pedido a la IA para ese proveedor ("" si no hay guia).
function guiaDe(proveedorId) {
  const g = GUIAS[String(proveedorId || "").toLowerCase()];
  if (!g) return "";
  const reglas = g.reglas.map((r) => `- ${r}`).join("\n");
  const ejemplos = g.ejemplos.map((e, i) => `Ejemplo ${i + 1}\n  En la factura: ${e.factura}\n  Hay que extraer: ${e.extraer}`).join("\n");
  return `\n\nGuia de lectura de las facturas de ${g.nombre} (basada en: ${g.baseEn}):\n${g.documento}\n\nReglas de este proveedor:\n${reglas}\n\n${ejemplos}`;
}

module.exports = { GUIAS, guiaDe };
