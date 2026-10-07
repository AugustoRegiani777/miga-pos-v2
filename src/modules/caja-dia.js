// Los movimientos de plata del día, sin turnos ni usuarios.
//
// El dueño fue explícito: "me sirve que registre los movimientos de caja, no
// es necesario que marque turnos y usuarios todavía". Son tres empleados; un
// sistema de relevos sería ceremonia para un problema que no tiene.
//
// Lo que sí tiene: a las 11 paga 20 € de verdura y a las 20:30, cuando cierra,
// se tiene que acordar. Esto es para que lo anote cuando pasa.
//
// Por qué igual hay una "sesión" por debajo: la tabla `movimientos_caja` exige
// `sesion_uuid NOT NULL` (migración 020). En vez de pedir una migración nueva
// para aflojar esa restricción, se crea una sesión implícita por día, sola, la
// primera vez que se anota algo. Nadie la ve ni la nombra. Y si algún día
// quiere turnos de verdad, el modelo ya está listo y no hay que migrar nada.
//
// La aritmética no vive acá: está en caja-calculos.js. Esto solo decide qué se
// guarda y cuándo.

import { getAll } from "../db/idb.js";
import { todayISO } from "../utils/format.js";
import {
  abrirSesionCaja,
  registrarMovimientoCaja,
  anularMovimientoCaja,
  cargarCajaDelDia
} from "./caja-sesion.js";

// El nombre con el que se abre la sesión implícita. La base exige un texto no
// vacío; este dice la verdad: no se preguntó quién.
const SIN_PERSONA = "Caja";

// La sesión del día, creándola si todavía no existe.
//
// Dos avisos a quien toque esto:
//  - Es idempotente a propósito: se llama en cada movimiento y tiene que
//    devolver siempre la misma sesión para esa fecha.
//  - El fondo inicial arranca en 0 porque no se le pregunta. Si más adelante
//    se quiere pedir "con cuánto arrancás", va acá y no cambia nada más.
async function sesionDelDia(fecha) {
  const locales = await getAll("sesiones_caja");
  const delDia = locales.filter((s) => String(s.fecha).slice(0, 10) === fecha);
  if (delDia.length > 0) {
    // Si hubiera más de una (un día con turnos cargados antes de simplificar),
    // se usa la última abierta: es donde seguiría anotando quien está ahora.
    return delDia.sort((a, b) => (a.turno || 0) - (b.turno || 0))[delDia.length - 1];
  }
  return await abrirSesionCaja({
    fecha,
    abiertaPor: SIN_PERSONA,
    fondoInicialCentavos: 0
  });
}

// Anotar un gasto. Es el caso que más se va a usar: pagó algo del negocio.
export async function anotarGasto({ importeCentavos, motivo, categoria = null, afectaCajon = true, fecha = todayISO() }) {
  const sesion = await sesionDelDia(fecha);
  return await registrarMovimientoCaja({
    sesionUuid: sesion.uuid, fecha, tipo: "gasto",
    importeCentavos, motivo, categoria, afectaCajon
  });
}

// Sacar plata del cajón sin que sea un gasto: al banco, a la caja fuerte.
export async function anotarRetiro({ importeCentavos, motivo, fecha = todayISO() }) {
  const sesion = await sesionDelDia(fecha);
  return await registrarMovimientoCaja({
    sesionUuid: sesion.uuid, fecha, tipo: "retiro", importeCentavos, motivo
  });
}

// Entra plata que no es una venta: cambio que se trae, un aporte, algo que
// devolvieron.
export async function anotarIngreso({ importeCentavos, motivo, fecha = todayISO() }) {
  const sesion = await sesionDelDia(fecha);
  return await registrarMovimientoCaja({
    sesionUuid: sesion.uuid, fecha, tipo: "ingreso", importeCentavos, motivo
  });
}

// Lo cargó mal: se anula. No se edita ni se borra — se appendea el importe al
// revés, enlazado al original. Los dos quedan a la vista y el total da bien
// solo. Es lo que va a pedir Hacienda cuando llegue.
export async function anularMovimiento(uuid, { motivo = "" } = {}) {
  return await anularMovimientoCaja(uuid, { motivo });
}

// Lo que se anotó hoy, listo para mostrar en una lista.
//
// Los pares anulados viajan marcados en vez de filtrados: que el que mira vea
// "pagué 50 de café / anulado" es más honesto que hacer desaparecer la fila, y
// evita la pregunta de "¿no había cargado algo?".
export async function movimientosDelDia(fecha = todayISO()) {
  const { movimientos } = await cargarCajaDelDia(fecha);
  const anuladosPorUuid = new Set(movimientos.filter((m) => m.corrigeUuid).map((m) => m.corrigeUuid));
  return movimientos
    .filter((m) => !m.corrigeUuid)
    .map((m) => ({ ...m, anulado: anuladosPorUuid.has(m.uuid) }))
    .sort((a, b) => String(b.ocurridoEn || "").localeCompare(String(a.ocurridoEn || "")));
}

// El total que el cierre necesita: cuánto salió y cuánto entró del cajón hoy,
// ya sin los anulados. Un movimiento que no toca el efectivo (un gasto pagado
// con tarjeta) cuenta como gasto pero no mueve el cajón.
export async function totalesDelDia(fecha = todayISO()) {
  const { movimientos } = await cargarCajaDelDia(fecha);
  const anulados = new Set(movimientos.filter((m) => m.corrigeUuid).map((m) => m.corrigeUuid));
  const vivos = movimientos.filter((m) => !m.corrigeUuid && !anulados.has(m.uuid));

  let gastosCentavos = 0, retirosCentavos = 0, ingresosCentavos = 0, netoCajonCentavos = 0;
  for (const m of vivos) {
    const importe = Number(m.importeCentavos) || 0;
    if (m.tipo === "gasto") gastosCentavos += Math.abs(importe);
    else if (m.tipo === "retiro") retirosCentavos += Math.abs(importe);
    else if (m.tipo === "ingreso") ingresosCentavos += importe;
    if (m.afectaCajon !== false) netoCajonCentavos += importe;
  }
  return { gastosCentavos, retirosCentavos, ingresosCentavos, netoCajonCentavos, cantidad: vivos.length };
}
