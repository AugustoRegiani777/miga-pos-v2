// Cuentas de la caja por turnos (puras: sin IndexedDB, sin red, sin reloj del
// sistema). Espeja la migracion 020 — sesiones_caja / movimientos_caja /
// arqueos_caja — en camelCase, igual que mapCierreRemoto en cierre.js.
//
// El caso de todos los dias es UN turno: se abre con un fondo, se cargan gastos
// a medida que pasan, y al final se cuenta la plata. Dos turnos con relevo es el
// caso que tiene que dar bien, no el de uso diario.
//
// Las tres cuentas que se usan todos los dias:
//   esperadoEnCajon()      cuanto deberia haber en el cajon ahora
//   diferenciaDeArqueo()   cuanto falta o sobra contra lo contado
//   netoDeMovimientos()    que se gasto / entro / se retiro hoy
//
//   esperado = fondo inicial + ventas en efectivo del turno + neto del ledger
//
// El neto del ledger ya viene firmado (ingreso +, gasto/retiro -), asi que el
// esperado es una suma y nadie tiene que acordarse de restar. Solo entran los
// movimientos con afectaCajon: un gasto pagado con tarjeta es gasto del negocio
// pero no mueve el efectivo.
//
// Todo en centavos ENTEROS. Nunca se suman decimales: 0.1 + 0.2 no da 0.3 y eso
// termina siendo un descuadre de caja que nadie entiende.
//
// Lo que ya vive en cierre-calculos.js NO se reimplementa aca: el split
// efectivo/tarjeta sale de desgloseFormaPago(), el formato de importes de
// centavosAInput(), y los umbrales de "diferencia chica / grande" son los
// mismos que usa calcularCierre().

import { desgloseFormaPago, centavosAInput } from "./cierre-calculos.js";

// ---------------------------------------------------------------------------
// Utilidades internas (entradas rotas no tiran excepciones: null -> 0, [] -> [])
// ---------------------------------------------------------------------------

const lista = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === "object") : []);

// Cualquier cosa que no sea un numero usable vale 0. Redondea por si alguien
// mando un float: dentro de este modulo los centavos son enteros, sin excepcion.
const cent = (v) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

const suma = (xs, f) => xs.reduce((total, x) => total + f(x), 0);

// afecta_cajon tiene DEFAULT true en la base: la ausencia del campo es "si afecta".
const afectaCajon = (m) => m.afectaCajon !== false;

// "Faltan 5,00 €" se lee mejor que "-500". centavosAInput ya hace la coma.
const euros = (centavos) => `${centavosAInput(cent(centavos))} €`;

// Orden determinista y sin reloj del sistema: por el string de tiempo que trae
// la fila, y el uuid como desempate para que dos filas del mismo instante no
// queden en un orden que dependa del motor de JS.
const porTiempo = (campo) => (a, b) => {
  const ta = String(a?.[campo] ?? "");
  const tb = String(b?.[campo] ?? "");
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a?.uuid ?? "").localeCompare(String(b?.uuid ?? ""));
};

// ---------------------------------------------------------------------------
// Ventas del turno que entran al cajon
// ---------------------------------------------------------------------------
// El split efectivo/tarjeta lo hace desgloseFormaPago (ventas.forma_pago, mig.
// 016). Lo unico que se agrega aca es sacar del efectivo lo que no llega al
// cajon: los paquetes Too Good To Go (los cobra la app) y lo que se cobro por
// plataforma. Mismo criterio que calcularCierre, pero sin el total de Postnet:
// un relevo no tiene cierre de Postnet y nunca lo va a tener.
export function ventasEnCajon(ventas, { tgtgEnCajon = false, plataformasCentavos = 0 } = {}) {
  const vigentes = lista(ventas).filter((v) => !v.anulada);
  const { efectivoCentavos, tarjetaCentavos } = desgloseFormaPago(vigentes);
  const tgtgCentavos = suma(vigentes.filter((v) => v.saleMode === "togoo"), (v) => cent(v.totalCentavos));
  // Solo descuenta el TGTG que estaba contado como efectivo; si se tapeo como
  // tarjeta ya no estaba en efectivoCentavos y restarlo lo contaria dos veces.
  const tgtgEfectivoCentavos = suma(
    vigentes.filter((v) => v.saleMode === "togoo" && (v.formaPago || "efectivo") === "efectivo"),
    (v) => cent(v.totalCentavos)
  );
  const fueraDelCajon = (tgtgEnCajon ? 0 : tgtgEfectivoCentavos) + cent(plataformasCentavos);
  return {
    ventasTotalCentavos: suma(vigentes, (v) => cent(v.totalCentavos)),
    tickets: vigentes.length,
    tgtgCentavos,
    ventasTarjetaCentavos: tarjetaCentavos, // cruce de control, no la verdad de la tarjeta
    ventasEfectivoCentavos: efectivoCentavos - fueraDelCajon
  };
}

// ---------------------------------------------------------------------------
// 3. Neto del turno, con los pares de correccion neteados
// ---------------------------------------------------------------------------
// Un movimiento mal cargado se corrige appendeando otro con el importe exacto
// al reves y corrigeUuid apuntando al original (la base no deja editar ni
// borrar). El neto sale bien solo — el par suma cero — pero los agregados que
// se MUESTRAN no: sin netear, "gastos de hoy" diria 70 € cuando se gastaron 20.
// Por eso los dos movimientos del par salen de ingresos/gastos/retiros.
//
// Si la correccion NO es el importe exacto al reves es un ajuste parcial (la
// migracion lo distingue): ahi los dos cuentan, porque la diferencia es real.
export function netoDeMovimientos(movimientos) {
  const todos = lista(movimientos);
  const porUuid = new Map(todos.filter((m) => m.uuid).map((m) => [m.uuid, m]));

  const anulados = new Set(); // uuids que se van del conteo (original + su correccion)
  const pares = [];
  const correccionesHuerfanas = []; // corrigeUuid que apunta a algo que no esta en la lista

  for (const m of [...todos].sort(porTiempo("ocurridoEn"))) {
    if (!m.corrigeUuid) continue;
    const original = porUuid.get(m.corrigeUuid);
    if (!original) { correccionesHuerfanas.push(m.uuid); continue; }
    // Una sola correccion netea a un original: si alguien cargo dos, la segunda
    // es plata de verdad y tiene que contarse.
    if (anulados.has(original.uuid) || anulados.has(m.uuid)) continue;
    if (cent(m.importeCentavos) + cent(original.importeCentavos) !== 0) continue; // ajuste parcial
    if (afectaCajon(m) !== afectaCajon(original)) continue; // no se cancelan: uno mueve el cajon y el otro no
    anulados.add(original.uuid);
    anulados.add(m.uuid);
    pares.push({ originalUuid: original.uuid, correccionUuid: m.uuid, importeCentavos: cent(original.importeCentavos) });
  }

  const delCajon = todos.filter(afectaCajon);
  const vigentes = delCajon.filter((m) => !anulados.has(m.uuid));
  const deTipo = (t) => vigentes.filter((m) => m.tipo === t);

  // netoCajonCentavos se suma sobre TODO el ledger del cajon (no solo vigentes)
  // a proposito: da el mismo numero porque cada par vale cero, y asi el
  // esperado no depende de que el neteo haya acertado.
  const netoCajonCentavos = suma(delCajon, (m) => cent(m.importeCentavos));

  const fueraDelCajon = todos.filter((m) => !afectaCajon(m) && !anulados.has(m.uuid));

  return {
    netoCajonCentavos,
    // Magnitudes positivas, que es como se muestran ("Gastos: 20,00 €").
    ingresosCentavos: suma(deTipo("ingreso"), (m) => cent(m.importeCentavos)),
    gastosCentavos: -suma(deTipo("gasto"), (m) => cent(m.importeCentavos)),
    retirosCentavos: -suma(deTipo("retiro"), (m) => cent(m.importeCentavos)),
    ajustesCentavos: suma(deTipo("ajuste"), (m) => cent(m.importeCentavos)), // firmado: un ajuste puede ir para cualquier lado
    // Gastos pagados con tarjeta/transferencia: son gasto del negocio y hay que
    // poder verlos, pero no entran en ninguna cuenta del efectivo.
    gastosFueraDelCajonCentavos: -suma(fueraDelCajon.filter((m) => m.tipo === "gasto"), (m) => cent(m.importeCentavos)),
    cantidad: todos.length,
    cantidadVigente: vigentes.length + fueraDelCajon.length,
    pares,
    anulados: [...anulados],
    correccionesHuerfanas
  };
}

// ---------------------------------------------------------------------------
// 1. Cuanto deberia haber en el cajon
// ---------------------------------------------------------------------------
// ventas: las del turno (ya filtradas por quien llama). Si no hay forma de
// saberlas se puede pasar ventasEfectivoCentavos directo y se usa ese numero.
export function esperadoEnCajon({
  sesion,
  movimientos = [],
  ventas = null,
  ventasEfectivoCentavos = null,
  tgtgEnCajon = false,
  plataformasCentavos = 0
} = {}) {
  const s = sesion && typeof sesion === "object" ? sesion : null;
  const fondoInicialCentavos = cent(s?.fondoInicialCentavos);
  const v = ventasEnCajon(ventas, { tgtgEnCajon, plataformasCentavos });
  const efectivo = ventasEfectivoCentavos === null || ventasEfectivoCentavos === undefined
    ? v.ventasEfectivoCentavos
    : cent(ventasEfectivoCentavos);
  const neto = netoDeMovimientos(movimientos);
  const esperadoCentavos = fondoInicialCentavos + efectivo + neto.netoCajonCentavos;

  const avisos = [];
  if (!s) avisos.push("No hay un turno de caja abierto: el fondo inicial se toma como 0.");
  if (esperadoCentavos < 0) avisos.push("El efectivo esperado da negativo: revisá el fondo y los gastos cargados.");
  if (neto.correccionesHuerfanas.length) {
    avisos.push("Hay una corrección que apunta a un movimiento de otro turno: revisá que esté bien cargada.");
  }

  return {
    sesionUuid: s?.uuid ?? null,
    fecha: s?.fecha ?? null,
    turno: s?.turno ?? null,
    fondoInicialCentavos,
    ventasTotalCentavos: v.ventasTotalCentavos,
    ventasEfectivoCentavos: efectivo,
    ventasTarjetaCentavos: v.ventasTarjetaCentavos,
    tgtgCentavos: v.tgtgCentavos,
    tickets: v.tickets,
    movimientosCentavos: neto.netoCajonCentavos,
    esperadoCentavos,
    neto,
    avisos
  };
}

// ---------------------------------------------------------------------------
// 2. Cuanto falta o sobra
// ---------------------------------------------------------------------------
// Signo: contado - esperado. Negativo = falta plata (igual que
// arqueos_caja.diferencia_centavos y que calcularCierre).
// Umbrales de nivel: los mismos que calcularCierre (0 = ok, <= 1 € = chico).
export function diferenciaDeArqueo({ contadoCentavos = null, esperadoCentavos = 0 } = {}) {
  const esperado = cent(esperadoCentavos);
  if (contadoCentavos === null || contadoCentavos === undefined || !Number.isFinite(Number(contadoCentavos))) {
    return {
      contadoCentavos: null,
      esperadoCentavos: esperado,
      diferenciaCentavos: null,
      signo: null,
      nivel: null,
      etiqueta: "Sin contar",
      texto: `Todavía no se contó el efectivo. Deberían haber ${euros(esperado)}.`
    };
  }
  const contado = cent(contadoCentavos);
  const diferenciaCentavos = contado - esperado;
  const signo = diferenciaCentavos === 0 ? "exacto" : diferenciaCentavos < 0 ? "falta" : "sobra";
  const nivel = diferenciaCentavos === 0 ? "ok" : Math.abs(diferenciaCentavos) <= 100 ? "chico" : "grande";
  const magnitud = euros(Math.abs(diferenciaCentavos));
  const etiqueta = signo === "exacto" ? "Cuadra" : signo === "falta" ? `Faltan ${magnitud}` : `Sobran ${magnitud}`;
  const texto = signo === "exacto"
    ? `Cuadra exacto: contaste ${euros(contado)}, que es lo que tenía que haber.`
    : signo === "falta"
      ? `Faltan ${magnitud}: contaste ${euros(contado)} y deberían haber ${euros(esperado)}.`
      : `Sobran ${magnitud}: contaste ${euros(contado)} y deberían haber ${euros(esperado)}.`;
  return { contadoCentavos: contado, esperadoCentavos: esperado, diferenciaCentavos, signo, nivel, etiqueta, texto };
}

// ---------------------------------------------------------------------------
// 5. Estado: la caja esta abierta o no (derivado, no es un campo guardado)
// ---------------------------------------------------------------------------
// De varios arqueos de la misma sesion el vigente es el mas reciente; los
// anteriores son historial (un arqueo mal contado se corrige appendeando otro).
// Misma convencion que cierresVigentesPorFecha.
export function arqueoVigente(arqueos) {
  const ordenados = lista(arqueos).sort(porTiempo("creadoEn"));
  return ordenados.length ? ordenados[ordenados.length - 1] : null;
}

// Abierta = todavia no tiene arqueo. Nada mas.
export function sesionAbierta(arqueos) {
  return arqueoVigente(arqueos) === null;
}

// ---------------------------------------------------------------------------
// 4a. Un turno completo: lo que necesita una pantalla de caja
// ---------------------------------------------------------------------------
export function resumenDeSesion({
  sesion,
  movimientos = [],
  ventas = null,
  ventasEfectivoCentavos = null,
  arqueos = [],
  tgtgEnCajon = false,
  plataformasCentavos = 0
} = {}) {
  const s = sesion && typeof sesion === "object" ? sesion : null;
  const delTurno = s?.uuid
    ? lista(movimientos).filter((m) => !m.sesionUuid || m.sesionUuid === s.uuid)
    : lista(movimientos);
  const arqueosDelTurno = s?.uuid
    ? lista(arqueos).filter((a) => !a.sesionUuid || a.sesionUuid === s.uuid)
    : lista(arqueos);

  const esperado = esperadoEnCajon({
    sesion: s, movimientos: delTurno, ventas, ventasEfectivoCentavos, tgtgEnCajon, plataformasCentavos
  });
  const arqueo = arqueoVigente(arqueosDelTurno);
  // Si ya se conto, se compara contra el esperado de AHORA. El esperado que
  // quedo guardado en el arqueo es la foto de ese momento y se devuelve aparte:
  // si despues se anulo una venta, los dos numeros son utiles y distintos.
  const diferencia = diferenciaDeArqueo({
    contadoCentavos: arqueo ? arqueo.contadoCentavos : null,
    esperadoCentavos: esperado.esperadoCentavos
  });

  return {
    sesionUuid: s?.uuid ?? null,
    fecha: s?.fecha ?? null,
    turno: s?.turno ?? null,
    abiertaPor: s?.abiertaPor ?? null,
    abierta: arqueo === null,
    ...esperado,
    arqueo: arqueo
      ? {
          uuid: arqueo.uuid,
          tipo: arqueo.tipo,
          contadoPor: arqueo.contadoPor ?? null,
          recibidoPor: arqueo.recibidoPor ?? null,
          contadoEn: arqueo.contadoEn ?? null,
          contadoCentavos: cent(arqueo.contadoCentavos),
          dejaCentavos: arqueo.dejaCentavos === null || arqueo.dejaCentavos === undefined ? null : cent(arqueo.dejaCentavos),
          // Lo retirado es contado - deja (comentario de arqueos_caja.deja_centavos)
          retiradoCentavos: arqueo.dejaCentavos === null || arqueo.dejaCentavos === undefined
            ? null
            : cent(arqueo.contadoCentavos) - cent(arqueo.dejaCentavos),
          esperadoSegunArqueoCentavos: cent(arqueo.esperadoCentavos),
          diferenciaSegunArqueoCentavos: cent(arqueo.diferenciaCentavos)
        }
      : null,
    diferencia,
    diferenciaCentavos: diferencia.diferenciaCentavos,
    historialArqueos: arqueosDelTurno.length
  };
}

// ---------------------------------------------------------------------------
// 4b. El dia entero: los turnos encadenados y el cierre casi lleno
// ---------------------------------------------------------------------------
// ventasPorSesion: { [sesionUuid]: ventas[] }. Quien llama ya sabe a que turno
// pertenece cada venta (ventas.sesion_caja_uuid, mig. 020). Si el dia tiene un
// solo turno — el caso normal — alcanza con pasar `ventas`.
export function resumenDelDia({
  fecha = null,
  sesiones = [],
  movimientos = [],
  arqueos = [],
  ventas = null,
  ventasPorSesion = null,
  tgtgEnCajon = false,
  plataformasCentavos = 0
} = {}) {
  const todas = lista(sesiones)
    .filter((s) => !fecha || !s.fecha || s.fecha === fecha)
    .sort((a, b) => cent(a.turno) - cent(b.turno) || porTiempo("abiertaEn")(a, b));

  const ventasDe = (s, indice) => {
    if (ventasPorSesion && s?.uuid && Array.isArray(ventasPorSesion[s.uuid])) return ventasPorSesion[s.uuid];
    if (ventasPorSesion) return [];
    // Sin desglose por turno: las ventas del dia se le atribuyen al unico turno.
    // Con mas de un turno no hay forma de repartirlas aca sin inventar, asi que
    // van todas al primero y queda un aviso.
    return indice === 0 ? lista(ventas) : [];
  };

  const turnos = todas.map((s, i) => resumenDeSesion({
    sesion: s,
    movimientos: lista(movimientos).filter((m) => m.sesionUuid === s.uuid),
    ventas: ventasDe(s, i),
    arqueos: lista(arqueos).filter((a) => a.sesionUuid === s.uuid),
    tgtgEnCajon,
    plataformasCentavos: i === 0 ? plataformasCentavos : 0
  }));

  const avisos = [];
  if (!todas.length) avisos.push("Todavía no se abrió la caja en este día.");
  if (todas.length > 1 && !ventasPorSesion && lista(ventas).length) {
    avisos.push("El día tiene más de un turno y las ventas no vienen separadas por turno: se cargaron todas al primero.");
  }

  // El arrastre: el deja_centavos de un arqueo deberia ser el fondo inicial del
  // turno siguiente. NADA en la base lo obliga (la migracion lo dice: no hay
  // trigger a proposito), asi que si no coinciden hay que decirlo.
  const chequeosDeArrastre = [];
  for (let i = 1; i < turnos.length; i++) {
    const previo = turnos[i - 1];
    const actual = turnos[i];
    const deja = previo.arqueo?.dejaCentavos;
    if (deja === null || deja === undefined) continue;
    const fondo = actual.fondoInicialCentavos;
    const desvioCentavos = fondo - deja;
    const coincide = desvioCentavos === 0;
    const chequeo = {
      desdeSesionUuid: previo.sesionUuid,
      hastaSesionUuid: actual.sesionUuid,
      dejaCentavos: deja,
      fondoInicialCentavos: fondo,
      desvioCentavos,
      coincide,
      texto: coincide
        ? `El turno ${actual.turno} abrió con los ${euros(fondo)} que dejó el turno ${previo.turno}.`
        : `El turno ${previo.turno} dejó ${euros(deja)} pero el turno ${actual.turno} abrió con ${euros(fondo)}: ${desvioCentavos < 0 ? "faltan" : "sobran"} ${euros(Math.abs(desvioCentavos))}.`
    };
    chequeosDeArrastre.push(chequeo);
    if (!coincide) avisos.push(chequeo.texto);
    // El enlace explicito tambien es opcional: si esta y no apunta al turno
    // anterior, es otra cosa que conviene ver.
    if (actual.sesionUuid && todas[i].sesionPreviaUuid && todas[i].sesionPreviaUuid !== previo.sesionUuid) {
      avisos.push(`El turno ${actual.turno} dice relevar a otro turno, no al ${previo.turno}.`);
    }
  }

  // Los movimientos del dia: todos los del ledger de esta fecha, incluso si
  // quedaron huerfanos de sesion. No se descartan — es plata que salio o entro
  // del cajon igual — pero se avisa, porque no aparecen en ningun turno.
  const movimientosDelDia = lista(movimientos).filter((m) => !fecha || !m.fecha || m.fecha === fecha);
  const netoDelDia = netoDeMovimientos(movimientosDelDia);
  const uuidsDeTurno = new Set(todas.map((s) => s.uuid));
  const huerfanos = movimientosDelDia.filter((m) => !m.sesionUuid || !uuidsDeTurno.has(m.sesionUuid));
  if (huerfanos.length) {
    avisos.push(`Hay ${huerfanos.length === 1 ? "un movimiento" : `${huerfanos.length} movimientos`} del día que no pertenecen a ningún turno: entran en la cuenta del día pero no en la de un turno.`);
  }

  // Lo que se saco del cajon EN UN RELEVO (contado - deja de cada turno que no
  // es el ultimo). No esta en el ledger: la migracion lo deja implicito en el
  // arqueo ("lo retirado es contado - deja"). Sin este numero, la cuenta del
  // dia completo no cierra cuando hubo mas de un turno. Ver la nota de
  // `retirosEquivalenteCentavos` mas abajo.
  const retiradoEnRelevosCentavos = suma(
    turnos.slice(0, -1).filter((t) => t.arqueo && t.arqueo.retiradoCentavos !== null),
    (t) => t.arqueo.retiradoCentavos
  );

  const diferenciasContadas = turnos.filter((t) => t.diferencia.diferenciaCentavos !== null);
  const diferenciaCentavos = diferenciasContadas.length
    ? suma(diferenciasContadas, (t) => t.diferencia.diferenciaCentavos)
    : null;

  const ultimo = turnos[turnos.length - 1] || null;
  const arqueoFinal = ultimo?.arqueo || null;
  const sinContar = turnos.filter((t) => t.abierta);
  if (sinContar.length) {
    avisos.push(sinContar.length === 1
      ? `El turno ${sinContar[0].turno} sigue abierto: todavía no se contó el efectivo.`
      : `Hay ${sinContar.length} turnos sin contar el efectivo.`);
  }

  const ventasTotalCentavos = suma(turnos, (t) => t.ventasTotalCentavos);
  const fondoInicialCentavos = turnos.length ? turnos[0].fondoInicialCentavos : 0;

  return {
    fecha,
    turnos,
    cantidadTurnos: turnos.length,
    abierta: turnos.some((t) => t.abierta),
    // Diferencia del dia = la suma de las diferencias de los turnos. Asi un
    // faltante aparece en el turno donde paso y el total sigue cerrando.
    diferenciaCentavos,
    diferenciaTexto: diferenciaCentavos === null
      ? "Todavía falta contar algún turno."
      : diferenciaCentavos === 0
        ? "El día cuadra exacto."
        : `${diferenciaCentavos < 0 ? "Faltan" : "Sobran"} ${euros(Math.abs(diferenciaCentavos))} en el día.`,
    ventasTotalCentavos,
    ventasEfectivoCentavos: suma(turnos, (t) => t.ventasEfectivoCentavos),
    ventasTarjetaCentavos: suma(turnos, (t) => t.ventasTarjetaCentavos),
    tgtgCentavos: suma(turnos, (t) => t.tgtgCentavos),
    tickets: suma(turnos, (t) => t.tickets),
    neto: netoDelDia,
    movimientosCentavos: netoDelDia.netoCajonCentavos,
    retiradoEnRelevosCentavos,
    chequeosDeArrastre,
    avisos,

    // Lo que el formulario del cierre ya puede traer puesto. Nombres iguales a
    // los de cierres_caja (ver mapCierreRemoto en cierre.js) para que se pueda
    // volcar sin traducir.
    paraCierre: {
      fecha,
      fondoInicialCentavos,                        // el del PRIMER turno del dia
      ventasTotalCentavos,
      tickets: suma(turnos, (t) => t.tickets),
      tgtgCentavos: suma(turnos, (t) => t.tgtgCentavos),
      movimientosCentavos: netoDelDia.netoCajonCentavos,
      // cierres_caja.retiros_centavos es el numero tipeado a mano del modelo
      // viejo. Con el ledger en uso va en 0: cargar las dos cosas cuenta los
      // retiros dos veces (lo dice el COMMENT de la migracion 020).
      retirosCentavos: 0,
      // Esto es lo que se le pasa a calcularCierre() como `retirosCentavos`.
      // calcularCierre no tiene parametro para el ledger; su cuenta es
      // `fondo + efectivo - retiros`, asi que el neto firmado en negativo da
      // exactamente `fondo + efectivo + neto`. Es un truco de signo, no una
      // cuenta nueva: el esperado lo sigue calculando una sola implementacion.
      //
      // Y se le suma lo retirado en los relevos, que NO esta en el ledger. Sin
      // eso, un dia de dos turnos no cierra: el fondo del dia es el del primer
      // turno, pero esa plata ya se saco del cajon al mediodia. Con un solo
      // turno — el caso normal — este termino es 0 y no cambia nada.
      retirosEquivalenteCentavos: -netoDelDia.netoCajonCentavos + retiradoEnRelevosCentavos,
      retiradoEnRelevosCentavos,
      contadoCentavos: arqueoFinal ? arqueoFinal.contadoCentavos : null,
      fondoMananaCentavos: arqueoFinal ? arqueoFinal.dejaCentavos : null,
      // Cruce de control. La verdad de la tarjeta es el cierre de Postnet, que
      // se tipea a mano: este numero no lo reemplaza nunca.
      tarjetaSegunSistemaCentavos: suma(turnos, (t) => t.ventasTarjetaCentavos),
      turnos: turnos.length,
      sesionUuid: ultimo?.sesionUuid ?? null,
      arqueoUuid: arqueoFinal?.uuid ?? null,
      cerradoPor: arqueoFinal?.contadoPor ?? ultimo?.abiertaPor ?? null
    }
  };
}
