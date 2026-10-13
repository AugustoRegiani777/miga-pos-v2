// Comprobacion de la cuenta de una linea de factura. Sin dependencias: se prueba solo.
//
// Una factura trae, por cada producto, cantidad, (a veces) cuanto pesa cada unidad, precio por
// unidad de medida e importe. Esas cuatro cosas tienen que cuadrar:
//     importe = cantidad x (peso por unidad, si hay; si no 1) x precio
// Si no cuadra, la IA leyo mal alguno de los datos (el caso real: tomo los kilos totales de la
// segunda fila de la descripcion como si fueran las unidades). No se corrige sola: se baja la
// confianza y se avisa EN LA LINEA para que la persona la mire antes de cargar el stock.

const TOLERANCIA = 0.03; // 3 %: redondeos del proveedor

const redondear = (n) => Math.round(n * 100) / 100;
const coma = (n) => String(redondear(n)).replace(".", ",");

// Devuelve null si no hay datos para comprobar; si hay, { cuadra, esperado, aviso? }.
function verificarCuenta(item) {
  const cantidad = Number(item?.cantidad);
  const importe = Number(item?.precio);
  const precioUnitario = Number(item?.precioUnitarioFactura);
  const factor = Number(item?.factorPorUnidadFactura);
  if (!(cantidad > 0) || !(importe > 0) || !(precioUnitario > 0)) return null;

  const pesoPorUnidad = factor > 0 ? factor : 1;
  const esperado = cantidad * pesoPorUnidad * precioUnitario;
  const diferencia = Math.abs(esperado - importe) / importe;
  if (diferencia <= TOLERANCIA) return { cuadra: true, esperado: redondear(esperado) };

  const cuenta = factor > 0
    ? `${coma(cantidad)} × ${coma(factor)} × ${coma(precioUnitario)}`
    : `${coma(cantidad)} × ${coma(precioUnitario)}`;
  return {
    cuadra: false,
    esperado: redondear(esperado),
    aviso: `La cuenta no cuadra: ${cuenta} = ${coma(esperado)} €, pero el importe de la línea es ${coma(importe)} €. Revisá la cantidad y la unidad contra la factura.`
  };
}

// Aplica la comprobacion a una linea: si no cuadra, baja la confianza y agrega el aviso.
function conVerificacion(item) {
  const v = verificarCuenta(item);
  if (!v || v.cuadra) return item;
  return { ...item, confianza: item.confianza === "alta" ? "media" : item.confianza, aviso: v.aviso };
}

module.exports = { verificarCuenta, conVerificacion };
