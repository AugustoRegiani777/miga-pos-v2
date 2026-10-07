import { getAll, withStores, requestToPromise } from "../db/idb.js";
import { todayISO, currentTime } from "../utils/format.js";
import { trySyncSesionCaja, trySyncMovimientoCaja, trySyncArqueoCaja } from "./sync.js";
import { fetchSesionesCaja, fetchMovimientosCaja, fetchArqueosCaja } from "../db/supabase.js";

// ---------------------------------------------------------------------------
// Persistencia de la caja por turnos (migracion 020).
//
// Este archivo hace UNA cosa: guardar y leer. La aritmetica (esperado en el
// cajon, diferencia, neto del turno) vive en caja-calculos.js — dos
// implementaciones de la misma cuenta siempre terminan discrepando, asi que
// aca no se calcula ninguna.
//
// Tres reglas que gobiernan todo lo de abajo:
//
// 1. OFFLINE PRIMERO. Cargar un gasto a las 11 de la mañana no puede depender
//    de que haya wifi: se escribe en IndexedDB y la cola de sync lo empuja
//    cuando pueda. Ninguna funcion de escritura espera a la nube.
//
// 2. APPEND-ONLY. Las tres tablas remotas no tienen politica de UPDATE ni de
//    DELETE (y sin politica, Postgres no da error: devuelve "0 filas
//    afectadas", asi que un PATCH pareceria funcionar y no haria nada). Aca no
//    hay ninguna funcion que edite ni borre. Un movimiento mal cargado se
//    anula con otro movimiento — ver anularMovimientoCaja.
//
// 3. uuid EN TODA FILA, generado al crearla (CLAUDE.md 8.7: las 259 ventas
//    duplicadas). Es la clave local Y la clave de deduplicacion del push, asi
//    que reintentar es inofensivo por construccion.
//
// Y el orden que no se negocia: primero `await withStores(...)`, DESPUES
// `trySync*`. Al reves se encola el envio antes de que la transaccion
// commitee, y si aborta sube a la nube algo que en el dispositivo no existe
// (paso el 05/10 con calibrarInsumo).
// ---------------------------------------------------------------------------

// El caso normal es UN turno por dia. Puede haber mas de uno, pero nada de
// aca esta optimizado ni generalizado para eso.
const PRIMER_TURNO = 1;

// Instante de negocio. Se arma con la fecha OPERATIVA + la hora real del
// reloj, no con `new Date()` pelado: corriendo con el reloj simulado (solo en
// local, ver todayISO) un movimiento del dia simulado tiene que caer dentro de
// ese dia y no en el de hoy de verdad. `creadoEn` si es el reloj real — son
// dos cosas distintas y las dos hacen falta para auditar.
function instanteDe(fecha) {
  const d = new Date(`${fecha}T${currentTime()}`);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function textoObligatorio(valor, campo) {
  const limpio = String(valor ?? "").trim();
  // Lo mismo que exige el CHECK de la base. Se valida aca tambien porque una
  // fila que viola un CHECK se rechaza con 23514, queda trabada en la cola, y
  // una operacion trabada apaga la reconciliacion de stock entera.
  if (!limpio) throw new Error(`Falta ${campo}.`);
  return limpio;
}

function centavosEnteros(valor, campo) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) throw new Error(`${campo} no es un importe valido.`);
  return n;
}

// --- Lecturas ---------------------------------------------------------------

const deFecha = (filas, fecha) => filas.filter((f) => f.fecha === fecha);

// Una sesion esta abierta si NO tiene arqueo. No es un campo, es la ausencia
// de un hecho: mismo criterio que el stock en vivo (se deriva del ledger) y
// que la vista caja_sesiones_estado de la migracion 020. Asi cerrar un turno
// nunca necesita un UPDATE.
function conEstado(sesiones, arqueos) {
  return sesiones.map((s) => {
    const suyos = arqueos
      .filter((a) => a.sesionUuid === s.uuid)
      .sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn)));
    // El arqueo vigente es el mas reciente; los anteriores son historial (asi
    // se corrige un recuento mal contado, appendeando otro).
    const vigente = suyos[suyos.length - 1] || null;
    return { ...s, arqueo: vigente, abierta: vigente == null };
  });
}

// Todo lo que necesita la pantalla de caja para un dia: los turnos, su ledger,
// sus arqueos y cual sigue abierto.
//
// Lee lo local y, si hay internet, lo une con la nube por uuid — con tres
// empleados y mas de un dispositivo, el turno que abrio otro tiene que
// aparecer. Si la nube no responde, se trabaja con lo local y listo.
export async function cargarCajaDelDia(fecha = todayISO()) {
  const [sesionesLocal, movimientosLocal, arqueosLocal] = await Promise.all([
    getAll("sesiones_caja"), getAll("movimientos_caja"), getAll("arqueos_caja")
  ]);

  let fuente = "nube";
  let remotos = { sesiones: [], movimientos: [], arqueos: [] };
  try {
    const [s, m, a] = await Promise.all([
      fetchSesionesCaja(fecha), fetchMovimientosCaja(fecha), fetchArqueosCaja(fecha)
    ]);
    remotos = { sesiones: s.map(mapSesionRemota), movimientos: m.map(mapMovimientoRemoto), arqueos: a.map(mapArqueoRemoto) };
  } catch {
    fuente = "local";
  }

  // Lo que vino de la nube y este dispositivo no conoce se guarda local, para
  // poder seguir trabajando sin wifi despues. Solo se AGREGA lo que falta:
  // ninguna fila existente se toca (append-only, y lo local puede tener algo
  // que todavia no subio).
  if (fuente === "nube") {
    await guardarFaltantes(remotos);
  }

  const sesiones = unir(deFecha(sesionesLocal, fecha), remotos.sesiones).sort((a, b) => a.turno - b.turno);
  const movimientos = unir(deFecha(movimientosLocal, fecha), remotos.movimientos)
    .sort((a, b) => String(a.ocurridoEn).localeCompare(String(b.ocurridoEn)));
  const arqueos = unir(deFecha(arqueosLocal, fecha), remotos.arqueos);

  const conSuEstado = conEstado(sesiones, arqueos);
  return {
    fecha,
    fuente,
    sesiones: conSuEstado,
    movimientos,
    arqueos,
    // El caso normal: un solo turno abierto. Si por algun motivo hubiera dos,
    // se devuelve el de turno mas alto (el ultimo que se abrio).
    sesionAbierta: conSuEstado.filter((s) => s.abierta).pop() || null
  };
}

// El uuid es la identidad: lo local y lo remoto son la misma fila. Gana lo
// remoto cuando esta en los dos (ya confirmado, con su creado_en del servidor).
function unir(locales, remotos) {
  const porUuid = new Map();
  for (const f of [...locales, ...remotos]) porUuid.set(f.uuid, f);
  return [...porUuid.values()];
}

async function guardarFaltantes({ sesiones, movimientos, arqueos }) {
  if (sesiones.length + movimientos.length + arqueos.length === 0) return;
  await withStores(["sesiones_caja", "movimientos_caja", "arqueos_caja"], "readwrite", async (stores) => {
    // `requestToPromise(store.get(...))` es la UNICA espera permitida dentro de
    // un withStores (cualquier otro await cierra la transaccion en silencio).
    // La comprobacion va adentro de la transaccion a proposito: si se leyera
    // afuera, un movimiento cargado entre la lectura y la escritura se
    // pisaria.
    for (const [nombre, filas] of [["sesiones_caja", sesiones], ["movimientos_caja", movimientos], ["arqueos_caja", arqueos]]) {
      for (const fila of filas) {
        const ya = await requestToPromise(stores[nombre].get(fila.uuid));
        if (!ya) stores[nombre].put(fila);
      }
    }
  });
}

// Los movimientos de un turno, en el orden en que pasaron.
export async function movimientosDeSesion(sesionUuid) {
  const todos = await getAll("movimientos_caja");
  return todos
    .filter((m) => m.sesionUuid === sesionUuid)
    .sort((a, b) => String(a.ocurridoEn).localeCompare(String(b.ocurridoEn)));
}

// --- Escrituras -------------------------------------------------------------

// Abre un turno. El unico dato que la app no deja elegir es el numero de
// turno: es el siguiente al ultimo del dia (1 si no hay ninguno).
//
// Si dos dispositivos abren el turno 1 del mismo dia sin verse, la base rechaza
// el segundo por el indice unico (fecha, turno) — y pushSesionCaja lo absorbe
// sin trabar la cola. El indice es la unica garantia real: mirar "ya hay una
// sesion?" desde la app tiene una carrera que ningun chequeo en JS cierra.
export async function abrirSesionCaja({
  fecha = todayISO(),
  abiertaPor,
  fondoInicialCentavos,
  fondoInicialOrigen = "contado",
  sesionPreviaUuid = null,
  dispositivo = null,
  nota = ""
}) {
  const nombre = textoObligatorio(abiertaPor, "el nombre de quien abre");
  const fondo = centavosEnteros(fondoInicialCentavos, "El fondo inicial");
  if (fondo < 0) throw new Error("El fondo inicial no puede ser negativo.");
  if (!["contado", "arrastre"].includes(fondoInicialOrigen)) {
    throw new Error(`Origen de fondo invalido: ${fondoInicialOrigen}.`);
  }

  const delDia = deFecha(await getAll("sesiones_caja"), fecha);
  const turno = delDia.length === 0 ? PRIMER_TURNO : Math.max(...delDia.map((s) => s.turno || 0)) + 1;

  const sesion = {
    uuid: crypto.randomUUID(),
    fecha,
    turno,
    abiertaPor: nombre,
    abiertaEn: instanteDe(fecha),
    fondoInicialCentavos: fondo,
    fondoInicialOrigen,
    sesionPreviaUuid: sesionPreviaUuid || null,
    dispositivo: dispositivo || null,
    nota: String(nota || "").trim() || null,
    creadoEn: new Date().toISOString()
  };

  await withStores(["sesiones_caja"], "readwrite", (stores) => {
    stores.sesiones_caja.put(sesion);
  });
  // Fuera del withStores y fire-and-forget: la caja no espera a Supabase.
  trySyncSesionCaja(sesion).catch(() => {});

  return sesion;
}

// El signo lo ata el tipo (CHECK movimientos_caja_signo_check): ingreso entra,
// gasto y retiro salen. La app puede pasar el importe en positivo siempre —
// aca se normaliza, porque mandar un gasto en positivo seria un 23514 trabado
// en la cola, no un error de usuario recuperable.
function importeConSigno(tipo, importeCentavos) {
  const n = centavosEnteros(importeCentavos, "El importe");
  if (n === 0) throw new Error("El importe no puede ser cero.");
  if (tipo === "ingreso") return Math.abs(n);
  if (tipo === "gasto" || tipo === "retiro") return -Math.abs(n);
  return n; // 'ajuste': el signo lo decide quien lo carga (solo no puede ser 0)
}

const TIPOS_MOVIMIENTO = ["ingreso", "gasto", "retiro", "ajuste"];

// Arma la fila (con su uuid) sin escribir nada. Separado de la escritura
// porque el arqueo de relevo tiene que guardar su retiro en la MISMA
// transaccion que el arqueo, y para eso necesita el objeto, no la escritura.
function construirMovimiento({
  sesionUuid,
  fecha = todayISO(),
  tipo,
  importeCentavos,
  motivo,
  categoria = null,
  // false para un gasto pagado con tarjeta o transferencia: es gasto del
  // negocio pero no mueve el efectivo del cajon.
  afectaCajon = true,
  comprobante = null,
  quien = null,
  corrigeUuid = null,
  ocurridoEn = null
}) {
  if (!TIPOS_MOVIMIENTO.includes(tipo)) {
    // El CHECK de la base tiene el juego cerrado de tipos. Un tipo nuevo se
    // agrega PRIMERO en una migracion y DESPUES en el codigo (si no: 23514,
    // cola trabada, reconciliacion de stock apagada — paso el 05/10).
    throw new Error(`Tipo de movimiento invalido: ${tipo}.`);
  }
  return {
    uuid: crypto.randomUUID(),
    sesionUuid: textoObligatorio(sesionUuid, "la sesion de caja"),
    fecha,
    tipo,
    importeCentavos: importeConSigno(tipo, importeCentavos),
    motivo: textoObligatorio(motivo, "el motivo"),
    categoria: String(categoria || "").trim() || null,
    afectaCajon: afectaCajon !== false,
    comprobante: String(comprobante || "").trim() || null,
    quien: String(quien || "").trim() || null,
    corrigeUuid: corrigeUuid || null,
    ocurridoEn: ocurridoEn || instanteDe(fecha),
    creadoEn: new Date().toISOString()
  };
}

export async function registrarMovimientoCaja(datos) {
  const movimiento = construirMovimiento(datos);

  await withStores(["movimientos_caja"], "readwrite", (stores) => {
    stores.movimientos_caja.put(movimiento);
  });
  trySyncMovimientoCaja(movimiento).catch(() => {});

  return movimiento;
}

// "Anular" un movimiento mal cargado. No lo edita ni lo borra (no se puede, y
// no se querria: viene la conexion con Hacienda y todo tiene que quedar
// auditable): appendea el importe exacto al reves, con corrige_uuid apuntando
// al original. Los dos quedan a la vista y la suma del ledger da bien sola.
//
// El contra-movimiento es siempre tipo 'ajuste' y no el tipo del original,
// porque el CHECK de la base ata el signo al tipo: el reverso de un gasto es
// positivo y "gasto positivo" la base no lo acepta. 'ajuste' es el unico tipo
// que admite cualquier signo, y es justo lo que esto es.
export async function anularMovimientoCaja(uuid, { quien = null, motivo = "" } = {}) {
  const todos = await getAll("movimientos_caja");
  const original = todos.find((m) => m.uuid === uuid);
  if (!original) throw new Error("Ese movimiento no existe en este dispositivo.");
  if (original.corrigeUuid) throw new Error("Ese movimiento ya es la anulacion de otro.");
  // Anular dos veces dejaria el ledger descuadrado al revés. El CHECK
  // corrige_uuid <> uuid de la base solo evita el autoreferente, esto evita el
  // doble reverso.
  if (todos.some((m) => m.corrigeUuid === uuid)) throw new Error("Ese movimiento ya estaba anulado.");

  return registrarMovimientoCaja({
    sesionUuid: original.sesionUuid,
    fecha: original.fecha,
    tipo: "ajuste",
    importeCentavos: -original.importeCentavos,
    motivo: String(motivo || "").trim() || `Anula: ${original.motivo}`,
    categoria: original.categoria,
    afectaCajon: original.afectaCajon,
    quien,
    corrigeUuid: original.uuid
  });
}

// Registra un recuento de efectivo: el relevo entre turnos ('relevo') o el del
// final del dia ('final'). El relevo es OPCIONAL — un dia de un solo turno no
// pasa por aca hasta el cierre.
//
// Los importes entran ya calculados (esperado, diferencia, la foto de ventas):
// esa aritmetica es de caja-calculos.js. Esta funcion solo los guarda, tal cual
// decian al momento de contar, para que mañana se pueda explicar por que la
// diferencia era la que era aunque despues se anule una venta de hoy.
//
// Lo UNICO que agrega por su cuenta es el movimiento de retiro del relevo (ver
// el comentario largo mas abajo). Devuelve { ...arqueo, retiro } — `retiro` es
// null cuando no se saco nada del cajon.
export async function registrarArqueoCaja({
  sesionUuid,
  fecha = todayISO(),
  tipo = "relevo",
  contadoPor,
  recibidoPor = null,
  contadoCentavos,
  dejaCentavos = null,
  fondoInicialCentavos,
  ventasTotalCentavos = 0,
  ventasEfectivoCentavos = 0,
  ventasTarjetaCentavos = 0,
  tickets = 0,
  movimientosCentavos = 0,
  esperadoCentavos,
  diferenciaCentavos,
  nota = ""
}) {
  if (!["relevo", "final"].includes(tipo)) throw new Error(`Tipo de arqueo invalido: ${tipo}.`);
  const contado = centavosEnteros(contadoCentavos, "El efectivo contado");
  if (contado < 0) throw new Error("El efectivo contado no puede ser negativo.");
  const deja = dejaCentavos == null ? null : centavosEnteros(dejaCentavos, "Lo que queda en el cajon");
  if (deja != null && deja < 0) throw new Error("Lo que queda en el cajon no puede ser negativo.");

  const arqueo = {
    uuid: crypto.randomUUID(),
    sesionUuid: textoObligatorio(sesionUuid, "la sesion de caja"),
    fecha,
    tipo,
    contadoPor: textoObligatorio(contadoPor, "el nombre de quien cuenta"),
    recibidoPor: String(recibidoPor || "").trim() || null,
    contadoEn: instanteDe(fecha),
    contadoCentavos: contado,
    dejaCentavos: deja,
    fondoInicialCentavos: centavosEnteros(fondoInicialCentavos, "El fondo inicial"),
    ventasTotalCentavos: centavosEnteros(ventasTotalCentavos, "Las ventas"),
    ventasEfectivoCentavos: centavosEnteros(ventasEfectivoCentavos, "Las ventas en efectivo"),
    ventasTarjetaCentavos: centavosEnteros(ventasTarjetaCentavos, "Las ventas con tarjeta"),
    tickets: Math.round(Number(tickets) || 0),
    movimientosCentavos: centavosEnteros(movimientosCentavos, "El neto de movimientos"),
    esperadoCentavos: centavosEnteros(esperadoCentavos, "El esperado"),
    diferenciaCentavos: centavosEnteros(diferenciaCentavos, "La diferencia"),
    nota: String(nota || "").trim() || null,
    creadoEn: new Date().toISOString()
  };

  // EL RETIRO DEL RELEVO ENTRA AL LEDGER.
  //
  // En un relevo, lo que se cuenta (`contado`) no es lo que queda para el que
  // entra (`deja`): la diferencia se saca del cajon. Eso es plata real
  // saliendo, y hasta ahora quedaba implicita dentro del arqueo, fuera de
  // movimientos_caja. Medido en una prueba de dos turnos: salieron 225 EUR en
  // el relevo y la cuenta del cierre del dia alimentada con el ledger daba
  // -230 EUR de falso faltante, cuando el faltante real era -5 EUR. Con el
  // retiro en el ledger la cuenta cierra sola y, con Hacienda en camino, queda
  // auditable como cualquier otro movimiento.
  //
  // Se escribe en la MISMA transaccion que el arqueo: o quedan los dos, o no
  // queda ninguno. Si fueran dos transacciones y la segunda fallara, el cajon
  // tendria un arqueo que dice que salio plata y un ledger que no la vio.
  //
  // Si contado == deja no se saco nada y no se escribe nada.
  const retirado = deja == null ? 0 : contado - deja;
  const retiro = (tipo === "relevo" && retirado > 0)
    ? construirMovimiento({
        sesionUuid: arqueo.sesionUuid,
        fecha,
        tipo: "retiro",
        importeCentavos: retirado,
        motivo: `Retiro del cajon en el relevo de ${arqueo.contadoPor}`,
        // Marca legible por codigo para que la cuenta del turno que se esta
        // cerrando NO lo cuente dos veces: los importes del arqueo
        // (movimientosCentavos, esperadoCentavos) son la foto de ANTES de este
        // retiro, asi que `contado - esperado = diferencia` sigue siendo cierto
        // en la fila guardada. Para el dia y para el turno siguiente, en cambio,
        // este movimiento es exactamente lo que faltaba.
        categoria: "relevo",
        quien: arqueo.contadoPor,
        // El mismo instante que el recuento: son el mismo hecho.
        ocurridoEn: arqueo.contadoEn
      })
    : null;

  await withStores(["arqueos_caja", "movimientos_caja"], "readwrite", (stores) => {
    stores.arqueos_caja.put(arqueo);
    if (retiro) stores.movimientos_caja.put(retiro);
  });
  // Los dos trySync van DESPUES del withStores (nunca adentro): encolar antes
  // de que la transaccion commitee puede subir a la nube algo que en el
  // dispositivo no existe.
  trySyncArqueoCaja(arqueo).catch(() => {});
  if (retiro) trySyncMovimientoCaja(retiro).catch(() => {});

  return { ...arqueo, retiro };
}

// --- Mapeo de la nube a la forma local -------------------------------------

function mapSesionRemota(r) {
  return {
    uuid: r.uuid,
    fecha: r.fecha,
    turno: r.turno,
    abiertaPor: r.abierta_por,
    abiertaEn: r.abierta_en,
    fondoInicialCentavos: r.fondo_inicial_centavos,
    fondoInicialOrigen: r.fondo_inicial_origen,
    sesionPreviaUuid: r.sesion_previa_uuid || null,
    dispositivo: r.dispositivo || null,
    nota: r.nota || null,
    creadoEn: r.creado_en
  };
}

function mapMovimientoRemoto(r) {
  return {
    uuid: r.uuid,
    sesionUuid: r.sesion_uuid,
    fecha: r.fecha,
    tipo: r.tipo,
    importeCentavos: r.importe_centavos,
    motivo: r.motivo,
    categoria: r.categoria || null,
    afectaCajon: r.afecta_cajon !== false,
    comprobante: r.comprobante || null,
    quien: r.quien || null,
    corrigeUuid: r.corrige_uuid || null,
    ocurridoEn: r.ocurrido_en,
    creadoEn: r.creado_en
  };
}

function mapArqueoRemoto(r) {
  return {
    uuid: r.uuid,
    sesionUuid: r.sesion_uuid,
    fecha: r.fecha,
    tipo: r.tipo,
    contadoPor: r.contado_por,
    recibidoPor: r.recibido_por || null,
    contadoEn: r.contado_en,
    contadoCentavos: r.contado_centavos,
    dejaCentavos: r.deja_centavos,
    fondoInicialCentavos: r.fondo_inicial_centavos,
    ventasTotalCentavos: r.ventas_total_centavos,
    ventasEfectivoCentavos: r.ventas_efectivo_centavos,
    ventasTarjetaCentavos: r.ventas_tarjeta_centavos,
    tickets: r.tickets,
    movimientosCentavos: r.movimientos_centavos,
    esperadoCentavos: r.esperado_centavos,
    diferenciaCentavos: r.diferencia_centavos,
    nota: r.nota || null,
    creadoEn: r.creado_en
  };
}
