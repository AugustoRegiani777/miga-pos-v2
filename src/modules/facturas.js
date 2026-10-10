import { getAll } from "../db/idb.js";
import { todayISO } from "../utils/format.js";
import { construirInsumoNuevo, construirLineaProveedor } from "./catalogo-armar.js";
import { guardarCatalogo } from "./catalogo-guardar.js";

// Convierte un archivo (foto o adjunto) a data URL base64, formato que
// espera la funcion serverless.
export function archivoABase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

// Llama a la funcion serverless que lee la factura con IA. La imagen viaja
// en base64 y no queda guardada en ningun lado — solo se usa para esta
// lectura puntual (ver netlify/functions/procesar-factura.js).
export async function leerFactura(proveedorId, imagenBase64) {
  const res = await fetch("/.netlify/functions/procesar-factura", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ proveedorId, imagen: imagenBase64 })
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`No se pudo leer la factura (${res.status}). ${texto}`.trim());
  }
  const data = await res.json();
  return Array.isArray(data.items) ? data.items : [];
}

// Aplica las lineas ya revisadas y confirmadas por el usuario: suma stock al
// insumo correspondiente (creandolo si hace falta) y deja guardada la fila
// de proveedor_insumos para que la proxima factura de este proveedor
// matchee sola. Nada de esto corre hasta que el usuario confirma la
// pantalla de revision — la IA nunca escribe directo.
//
// Cada linea de `lineas` trae: { insumoId, nombreDetectado, cantidad, unidad,
// precio, esNuevo, nuevoNombre, nuevaUnidad, nuevoStockMinimo, nuevoStockCritico }
//
// `nuevoProveedor`, si viene, trae { id, nombre, tel, email, diasCiclo } — el
// proveedor tampoco se crea hasta este momento (mismo principio que los
// insumos nuevos): si el usuario cancela la factura antes de confirmar, no
// queda ningun proveedor huerfano creado.
export async function confirmarFactura(proveedorId, lineas, nuevoProveedor = null) {
  const now = new Date().toISOString();
  const fecha = todayISO();

  const insumosActuales = await getAll("insumos");
  const insumosById = new Map(insumosActuales.map((i) => [i.id, i]));
  const idsUsados = new Set(insumosById.keys());

  const operaciones = lineas.map((linea) => {
    const cantidad = Number(linea.cantidad) || 0;
    if (linea.esNuevo) {
      const insumo = construirInsumoNuevo(linea.nuevoNombre || linea.nombreDetectado, idsUsados, {
        unidad: linea.nuevaUnidad || linea.unidad,
        stockMinimo: linea.nuevoStockMinimo,
        stockCritico: linea.nuevoStockCritico
      });
      return { linea, cantidad, insumo };
    }
    return { linea, cantidad, insumo: insumosById.get(linea.insumoId) };
  }).filter((op) => op.insumo);

  // Una factura puede traer el MISMO insumo en dos lineas. Cada linea suma sobre
  // el stock que dejo la anterior (y no sobre el que tenia al abrir la factura:
  // la segunda pisaba a la primera y se perdia una compra).
  const actuales = new Map();
  const movimientos = [];
  const lineasProveedor = [];

  for (const op of operaciones) {
    // cantidadPorUnidad viene de la IA (o de una factura anterior de este mismo
    // proveedor, ver procesar-factura.js) y ya representa cuanto insumo hay, en
    // su unidad base, en UNA de las unidades contadas en "cantidad" — tiene en
    // cuenta el contenido real del paquete (ej. una caja de 6 botellas de 1.5L =
    // 9000ml), a diferencia del factorConversion generico del insumo.
    const cantidadPorUnidadLinea = Number(op.linea.cantidadPorUnidad);
    const factor = cantidadPorUnidadLinea > 0 ? cantidadPorUnidadLinea : (op.insumo.factorConversion || 1);
    const delta = op.cantidad * factor;

    const base = actuales.get(op.insumo.id) || op.insumo;
    const stockAnterior = Number(base.stockActual) || 0;
    const stockNuevo = stockAnterior + delta;
    actuales.set(op.insumo.id, { ...base, stockActual: stockNuevo, actualizadoEn: now });

    movimientos.push({
      uuid: crypto.randomUUID(),
      insumoId: op.insumo.id,
      tipo: "compra",
      cantidad: delta,
      stockAnterior,
      stockNuevo,
      fecha,
      creadoEn: now
    });

    lineasProveedor.push(construirLineaProveedor({
      proveedorId,
      insumoId: op.insumo.id,
      nombreProducto: op.linea.nombreDetectado,
      unidadCompra: op.linea.unidad || op.insumo.unidadCompra,
      cantidadPorUnidad: factor,
      precioUnitarioCentavos: op.cantidad > 0
        ? Math.round(((Number(op.linea.precio) || 0) / op.cantidad) * 100)
        : 0
    }, now));
  }

  // Proveedor nuevo, insumos, lineas y compras: UN paquete. El orden de envio lo
  // resuelve catalogo-guardar.js (antes, aca, la linea llegaba antes que su
  // proveedor y Supabase la rechazaba con un 409).
  await guardarCatalogo({
    proveedores: nuevoProveedor ? [{
      id: nuevoProveedor.id,
      nombre: nuevoProveedor.nombre,
      tel: nuevoProveedor.tel || "",
      email: nuevoProveedor.email || "",
      notas: "",
      diasCiclo: Number(nuevoProveedor.diasCiclo) || 7,
      activo: true
    }] : [],
    insumos: [...actuales.values()],
    lineasProveedor,
    movimientosInsumos: movimientos
  });

  return { insumosActualizados: operaciones.length };
}
