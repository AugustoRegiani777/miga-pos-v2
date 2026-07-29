import { getAll, withStores } from "../db/idb.js";
import { todayISO, normalizeText } from "../utils/format.js";
import { trySyncInsumosSnapshot, trySyncMovimientosInsumos, trySyncProveedorInsumosSnapshot } from "./sync.js";

function slugify(texto) {
  const base = normalizeText(texto).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base || `insumo-${Date.now()}`;
}

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
export async function confirmarFactura(proveedorId, lineas) {
  const now = new Date().toISOString();
  const fecha = todayISO();

  const insumosActuales = await getAll("insumos");
  const insumosById = new Map(insumosActuales.map((i) => [i.id, i]));
  const idsUsados = new Set(insumosById.keys());

  const operaciones = lineas.map((linea) => {
    const cantidad = Number(linea.cantidad) || 0;
    if (linea.esNuevo) {
      let insumoId = slugify(linea.nuevoNombre || linea.nombreDetectado);
      let sufijo = 2;
      while (idsUsados.has(insumoId)) {
        insumoId = `${slugify(linea.nuevoNombre || linea.nombreDetectado)}-${sufijo}`;
        sufijo += 1;
      }
      idsUsados.add(insumoId);
      const unidad = linea.nuevaUnidad || linea.unidad || "unidad";
      return {
        linea,
        cantidad,
        insumo: {
          id: insumoId,
          nombre: linea.nuevoNombre || linea.nombreDetectado,
          unidad,
          unidadCompra: unidad,
          factorConversion: 1,
          stockActual: 0,
          stockMinimo: Number(linea.nuevoStockMinimo) || 0,
          stockCritico: Number(linea.nuevoStockCritico) || 0,
          activo: true,
          creadoEn: now,
          actualizadoEn: now
        }
      };
    }
    return { linea, cantidad, insumo: insumosById.get(linea.insumoId) };
  }).filter((op) => op.insumo);

  const movimientosCreados = [];
  const proveedorInsumosCreados = [];

  await withStores(["insumos", "movimientos_insumos", "proveedor_insumos"], "readwrite", (stores) => {
    for (const op of operaciones) {
      // cantidadPorUnidad viene de la IA (o de una factura anterior de este
      // mismo proveedor, ver procesar-factura.js) y ya representa cuanto
      // insumo hay, en su unidad base, en UNA de las unidades contadas en
      // "cantidad" — tiene en cuenta el contenido real del paquete (ej. una
      // caja de 6 botellas de 1.5L = 9000ml), a diferencia del factorConversion
      // generico del insumo que asume un tamano de paquete estandar.
      const cantidadPorUnidadLinea = Number(op.linea.cantidadPorUnidad);
      const factor = cantidadPorUnidadLinea > 0 ? cantidadPorUnidadLinea : (op.insumo.factorConversion || 1);
      const delta = op.cantidad * factor;
      const stockAnterior = Number(op.insumo.stockActual) || 0;
      const stockNuevo = stockAnterior + delta;

      stores.insumos.put({ ...op.insumo, stockActual: stockNuevo, actualizadoEn: now });

      const movimiento = {
        uuid: crypto.randomUUID(),
        insumoId: op.insumo.id,
        tipo: "compra",
        cantidad: delta,
        stockAnterior,
        stockNuevo,
        fecha,
        creadoEn: now
      };
      stores.movimientos_insumos.add(movimiento);
      movimientosCreados.push(movimiento);

      const precioUnitarioCentavos = op.cantidad > 0
        ? Math.round(((Number(op.linea.precio) || 0) / op.cantidad) * 100)
        : 0;
      const proveedorInsumo = {
        id: `${proveedorId}:${op.insumo.id}`,
        proveedorId,
        insumoId: op.insumo.id,
        nombreProducto: op.linea.nombreDetectado,
        unidadCompra: op.linea.unidad || op.insumo.unidadCompra,
        cantidadPorUnidad: factor,
        precioUnitarioCentavos,
        activo: true
      };
      stores.proveedor_insumos.put(proveedorInsumo);
      proveedorInsumosCreados.push(proveedorInsumo);
    }
  });

  const [insumosFinal, proveedorInsumosFinal] = await Promise.all([getAll("insumos"), getAll("proveedor_insumos")]);
  trySyncInsumosSnapshot(insumosFinal).catch(() => {});
  trySyncProveedorInsumosSnapshot(proveedorInsumosFinal).catch(() => {});
  if (movimientosCreados.length > 0) trySyncMovimientosInsumos(movimientosCreados).catch(() => {});

  return { insumosActualizados: operaciones.length };
}
