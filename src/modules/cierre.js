import { getAll, putOne } from "../db/idb.js";
import { fetchVentasRango, fetchCierresCaja } from "../db/supabase.js";
import { salesForDay, mapVentaRemota } from "./business.js";
import { trySyncCierreCaja } from "./sync.js";
import { cierresVigentesPorFecha, versionesDeFecha } from "./cierre-calculos.js";

// Cada cierre se guarda tambien en este dispositivo (store "configuracion", clave
// "cierre_caja:<uuid>") para poder cerrar y ver el historial sin internet.
const PREFIJO = "cierre_caja:";

function mapCierreRemoto(r) {
  return {
    uuid: r.uuid,
    fecha: r.fecha,
    ventasTotalCentavos: r.ventas_total_centavos,
    tickets: r.tickets,
    tgtgCentavos: r.tgtg_centavos,
    tgtgEnCajon: r.tgtg_en_cajon,
    fondoInicialCentavos: r.fondo_inicial_centavos,
    tarjetaCentavos: r.tarjeta_centavos,
    tarjetaOrigen: r.tarjeta_origen,
    plataformasCentavos: r.plataformas_centavos,
    retirosCentavos: r.retiros_centavos,
    retirosNota: r.retiros_nota || "",
    contadoCentavos: r.contado_centavos,
    fondoMananaCentavos: r.fondo_manana_centavos,
    esperadoEfectivoCentavos: r.esperado_efectivo_centavos,
    diferenciaCentavos: r.diferencia_centavos,
    nota: r.nota || "",
    creadoEn: r.creado_en
  };
}

async function cierresLocales() {
  const filas = await getAll("configuracion");
  return filas.filter((f) => typeof f.id === "string" && f.id.startsWith(PREFIJO)).map((f) => f.valor);
}

// Une lo de la nube con lo local (un cierre recien hecho sin internet todavia no
// esta en la nube) sin repetir: el uuid es la identidad.
function unir(remotos, locales) {
  const porUuid = new Map();
  for (const c of [...locales, ...remotos]) porUuid.set(c.uuid, c);
  return [...porUuid.values()];
}

// Todo lo que necesita la pantalla de cierre para una fecha.
export async function cargarCierre(fecha) {
  let ventas;
  let fuente = "nube";
  let remotos = [];
  try {
    ventas = (await fetchVentasRango(fecha, fecha)).map(mapVentaRemota);
  } catch {
    fuente = "local";
    ventas = await salesForDay(fecha);
  }
  // Aparte de las ventas: si la nube no responde o todavia no tiene la tabla de
  // cierres, igual se muestran las ventas y se trabaja con los cierres locales.
  try {
    remotos = (await fetchCierresCaja({ limit: 60 })).map(mapCierreRemoto);
  } catch { /* solo lo local */ }
  const todos = unir(remotos, await cierresLocales());
  const versiones = versionesDeFecha(todos, fecha);
  // El fondo de hoy se propone con lo que se dejo "para manana" en el ultimo cierre anterior.
  const previos = cierresVigentesPorFecha(todos.filter((c) => c.fecha < fecha));
  const previoConFondo = previos.find((c) => c.fondoMananaCentavos !== null && c.fondoMananaCentavos !== undefined);
  return {
    fecha,
    fuente,
    ventas,
    versiones,
    vigente: versiones[versiones.length - 1] || null,
    fondoSugeridoCentavos: previoConFondo ? previoConFondo.fondoMananaCentavos : null,
    historial: cierresVigentesPorFecha(todos).slice(0, 10)
  };
}

// Guarda un cierre NUEVO (nunca edita uno anterior). Local primero, nube por la cola.
export async function guardarCierre(datos) {
  const registro = {
    uuid: crypto.randomUUID(),
    creadoEn: new Date().toISOString(),
    tarjetaOrigen: "manual",
    ...datos
  };
  await putOne("configuracion", { id: `${PREFIJO}${registro.uuid}`, valor: registro, actualizadoEn: registro.creadoEn });
  trySyncCierreCaja(registro).catch(() => {});
  return registro;
}
