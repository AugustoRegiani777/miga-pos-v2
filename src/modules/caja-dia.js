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
import { esperadoEnCajon, diferenciaDeArqueo } from "./caja-calculos.js";
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
// ¿Ya se abrio la caja hoy? El primer paso de la pantalla depende de esto.
export async function aperturaDelDia(fecha = todayISO()) {
  const sesiones = await getAll("sesiones_caja");
  const delDia = sesiones.filter((x) => String(x.fecha).slice(0, 10) === fecha);
  if (delDia.length === 0) return null;
  const s = delDia.sort((a, b) => (a.turno || 0) - (b.turno || 0))[delDia.length - 1];
  return {
    uuid: s.uuid,
    fondoInicialCentavos: Number(s.fondoInicialCentavos) || 0,
    abiertaPor: s.abiertaPor,
    abiertaEn: s.abiertaEn,
    // Una apertura "implicita" (fondo 0, sin nombre) es la que crea el sistema
    // solo cuando alguien anota un pago sin haber abierto. La pantalla la
    // trata distinto: sigue pidiendo con cuanto se abrio.
    implicita: s.abiertaPor === SIN_PERSONA && (Number(s.fondoInicialCentavos) || 0) === 0
  };
}

// Paso 1: abrir la caja con el fondo contado.
export async function abrirCaja({ fondoInicialCentavos, fecha = todayISO(), quien = "" }) {
  const yaAbierta = await aperturaDelDia(fecha);
  if (yaAbierta && !yaAbierta.implicita) {
    throw new Error("La caja de hoy ya está abierta.");
  }
  if (yaAbierta?.implicita) {
    // Ya hay movimientos colgando de esa sesion: no se crea otra (quedarian
    // huerfanos), se corrige el fondo con un ajuste, que es la forma
    // append-only de arreglar un numero ya guardado.
    const diferencia = (Number(fondoInicialCentavos) || 0) - yaAbierta.fondoInicialCentavos;
    if (diferencia !== 0) {
      await registrarMovimientoCaja({
        sesionUuid: yaAbierta.uuid, fecha, tipo: "ajuste",
        importeCentavos: diferencia,
        motivo: "Fondo con el que se abrió la caja",
        categoria: "apertura"
      });
    }
    return { ...yaAbierta, fondoInicialCentavos: Number(fondoInicialCentavos) || 0 };
  }
  const sesion = await abrirSesionCaja({
    fecha,
    abiertaPor: String(quien || "").trim() || SIN_PERSONA,
    fondoInicialCentavos: Number(fondoInicialCentavos) || 0
  });
  return { uuid: sesion.uuid, fondoInicialCentavos: sesion.fondoInicialCentavos, implicita: false };
}

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
// Paso 2: un pago. El dueño lo describio como "que pago y a quien y que
// compro": dos datos distintos que antes entraban apretados en un solo campo.
// El motivo guardado los junta ("Verdura — Delicias Vegetales") porque la base
// exige un texto no vacio y asi se lee solo en cualquier listado.
export async function anotarPago({ importeCentavos, concepto, aQuien = "", enEfectivo = true, fecha = todayISO() }) {
  const sesion = await sesionDelDia(fecha);
  const quien = String(aQuien || "").trim();
  const que = String(concepto || "").trim();
  return await registrarMovimientoCaja({
    sesionUuid: sesion.uuid, fecha, tipo: "gasto",
    importeCentavos,
    motivo: quien ? `${que} — ${quien}` : que,
    categoria: quien || null,
    afectaCajon: enEfectivo !== false
  });
}

// Se mantiene el nombre viejo para no romper lo que ya lo llamaba.
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

// Paso 3: la foto del cajón ANTES de retirar. El dueño lo pidio asi: "se hace
// un mini cierre, de se retiro tanto, queda tanto, y deberia dar lo facturado
// con lo que hay, mas que nada en cash".
//
// No guarda nada: es para mostrar en el momento de decidir cuanto sacar.
export async function fotoDelCajon({ fecha = todayISO(), ventas = [], retiroCentavos = 0 } = {}) {
  const [sesion, { movimientos }] = await Promise.all([
    aperturaDelDia(fecha),
    cargarCajaDelDia(fecha)
  ]);
  const esperado = esperadoEnCajon({
    sesion: sesion ? { fondoInicialCentavos: sesion.fondoInicialCentavos } : { fondoInicialCentavos: 0 },
    movimientos,
    ventas
  });
  const retiro = Math.abs(Number(retiroCentavos) || 0);
  return {
    fondoCentavos: sesion?.fondoInicialCentavos || 0,
    ventasEfectivoCentavos: esperado.ventasEfectivoCentavos,
    movimientosCentavos: esperado.movimientosCentavos,
    esperadoCentavos: esperado.esperadoCentavos,
    retiroCentavos: retiro,
    quedaCentavos: esperado.esperadoCentavos - retiro,
    // Si al retirar se cuenta el efectivo, esto dice si cuadra.
    compararCon: (contadoCentavos) => diferenciaDeArqueo({ contadoCentavos, esperadoCentavos: esperado.esperadoCentavos })
  };
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
