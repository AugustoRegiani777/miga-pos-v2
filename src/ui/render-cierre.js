import { centsToMoney } from "../utils/format.js";
import { parseEuros, centavosAInput, armarCierreAutomatico, cuentaRealVsSistema } from "../modules/cierre-calculos.js";

// El cierre del dia, en dos pasos que se leen de arriba abajo:
//   1. CONTAR: el efectivo del cajon y el cierre del posnet, cada uno con "lo que dice el sistema" al lado.
//   2. LA CUENTA en dos columnas (REAL vs SISTEMA) para ver el contraste, y debajo los otros ingresos
//      (Glovo, Too Good To Go, Bizum) que no pasan por la caja.
// Todo lo que el sistema ya sabe (apertura, cobros, pagos, retiros) llega calculado: la persona solo mete
// los dos numeros reales.

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function campoDinero(id, etiqueta, valor, ayuda = "") {
  return `
    <label class="cierre-field" for="${id}">
      <span>${esc(etiqueta)}</span>
      <input type="text" inputmode="decimal" autocomplete="off" id="${id}" data-money value="${esc(valor)}" placeholder="0,00">
      ${ayuda ? `<small>${ayuda}</small>` : ""}
    </label>`;
}

const hora = (iso) => new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
const limpio = (v) => (v === null || Number.isNaN(v) ? null : v);
const aCero = (v) => (v === null || Number.isNaN(v) ? 0 : v);

// Lo que el sistema ya sabe del dia y la cuenta necesita: apertura (con sus ajustes), pagos, retiros e
// ingresos al cajon. `datos.vigente` = ya hay un cierre guardado (se muestra ESE en los campos).
export function baseDelCierre(datos) {
  const movimientos = datos.caja?.movimientos || [];
  const auto = armarCierreAutomatico({
    ventas: datos.ventas,
    apertura: datos.caja?.apertura || null,
    movimientos,
    fondoSugeridoCentavos: datos.fondoSugeridoCentavos
  });
  const v = datos.vigente;
  // Un ajuste (por ejemplo la correccion del fondo cuando se anoto un pago antes de abrir la caja) es parte
  // de la apertura: se suma al fondo, igual que en la cuenta rapida de la caja.
  const anulados = new Set(movimientos.filter((m) => m.anulado).map((m) => m.uuid));
  const ajustes = movimientos
    .filter((m) => m.tipo === "ajuste" && !m.anulado && !anulados.has(m.uuid) && m.afectaCajon !== false)
    .reduce((t, m) => t + (Number(m.importeCentavos) || 0), 0);
  const suma = (tipo) => auto.salidas.filter((x) => x.tipo === tipo).reduce((t, x) => t + x.centavos, 0);
  return {
    auto,
    vigente: v,
    fondoCentavos: (auto.fondoCentavos ?? 0) + ajustes,
    pagosCentavos: suma("pago"),
    retirosCentavos: suma("retiro"),
    ingresosCentavos: auto.ingresosCentavos || 0
  };
}

// Lee el formulario. null = vacio, NaN = importe invalido.
export function leerFormularioCierre(container) {
  const dinero = (id) => parseEuros(container.querySelector(`#${id}`)?.value);
  return {
    contadoCentavos: dinero("cierre-contado"),
    tarjetaCentavos: dinero("cierre-tarjeta"),
    fondoMananaCentavos: dinero("cierre-fondo-manana"),
    nota: container.querySelector("#cierre-nota")?.value.trim() || ""
  };
}

// Calcula con lo que hay en el formulario ahora mismo. `error` explica por que no se puede guardar.
export function calcularDesdeFormulario(container, datos) {
  const f = leerFormularioCierre(container);
  const base = baseDelCierre(datos);
  const invalidos = ["contadoCentavos", "tarjetaCentavos", "fondoMananaCentavos"].filter((k) => Number.isNaN(f[k]));
  const cuenta = cuentaRealVsSistema({
    ventas: datos.ventas,
    fondoCentavos: base.fondoCentavos,
    pagosCentavos: base.pagosCentavos,
    retirosCentavos: base.retirosCentavos,
    ingresosCentavos: base.ingresosCentavos,
    contadoCentavos: limpio(f.contadoCentavos),
    postnetRealCentavos: limpio(f.tarjetaCentavos)
  });
  let error = "";
  if (invalidos.length) error = "Hay un importe que no se entiende. Usá números, por ejemplo 12,50.";
  else if (f.contadoCentavos === null) error = "Anotá cuánto efectivo contaste.";
  else if (f.tarjetaCentavos === null) error = "Anotá el total del cierre del posnet (0 si no hubo).";
  const alertas = [];
  if (f.fondoMananaCentavos !== null && !Number.isNaN(f.fondoMananaCentavos) && f.contadoCentavos !== null && !Number.isNaN(f.contadoCentavos) && f.fondoMananaCentavos > f.contadoCentavos) {
    alertas.push("Querés dejar para mañana más efectivo del que contaste.");
  }
  return { form: f, base, cuenta, error, invalidos, alertas };
}

// ----------------------------------------------------------------------------------- dibujo
const claseDif = (n) => (n === null ? "" : n === 0 ? "ok" : Math.abs(n) <= 100 ? "chico" : "grande");
const celdaDif = (d) => {
  if (d === null || d === undefined) return `<td class="dif">—</td>`;
  const texto = d === 0 ? "cuadra" : `${d > 0 ? "+" : "−"}${centsToMoney(Math.abs(d))}`;
  return `<td class="dif"><small class="celda-et">Diferencia</small><span class="cierre-diff-mini is-${claseDif(d)}">${texto}</span></td>`;
};
const euro = (n) => (n === null || n === undefined ? "—" : centsToMoney(n));

function filaCuenta(texto, c, { signo = "", dif = true, clase = "" } = {}) {
  return `
    <tr class="${clase}">
      <th scope="row">${signo ? `<span class="signo">${signo}</span> ` : ""}${texto}</th>
      <td><small class="celda-et">Lo que contaste</small>${euro(c.real)}</td>
      <td><small class="celda-et">Dice el sistema</small>${euro(c.sistema)}</td>
      ${dif ? celdaDif(c.diferencia) : `<td class="dif"></td>`}
    </tr>`;
}

export function renderCuentaEnDosColumnas(el, cuenta, resumenEl = null) {
  const otros = cuenta.otrosIngresos;
  const hay = cuenta.efectivo.real !== null && cuenta.tarjeta.real !== null;
  const total = {
    real: hay ? cuenta.efectivo.real + cuenta.tarjeta.real : null,
    sistema: cuenta.efectivo.sistema + cuenta.tarjeta.sistema
  };
  total.diferencia = hay ? total.real - total.sistema : null;
  const vendido = cuenta.cierre.real ?? cuenta.cierre.sistema;
  // El cierre es solo contraste de totales: lo que hay contra lo que el sistema dice que deberia haber.
  // La apertura ya esta dentro del efectivo. El resumen de lo vendido va aparte.
  el.innerHTML = `
    <table class="cierre-tabla">
      <tbody>
        ${filaCuenta("Efectivo en caja", cuenta.efectivo)}
        ${filaCuenta("Posnet (tarjeta)", cuenta.tarjeta)}
        ${filaCuenta("Total <small class=\"cal-muted\">(efectivo + posnet)</small>", total, { clase: "es-total" })}
      </tbody>
    </table>`;
  if (resumenEl) resumenEl.innerHTML = htmlResumenDelDia(cuenta, hay, total, vendido);
}

// Lista corta de las transacciones del dia: hora, total y forma de pago (se puede corregir). El detalle de lo
// que se vendio se despliega aparte. Con el dia ya cerrado la lista es de solo lectura: se corrige con "Editar cierre".
const NOMBRE_PAGO = { efectivo: "Efectivo", tarjeta: "Tarjeta", glovo: "Glovo", bizum: "Bizum" };
function opcionesDePago(v) {
  const base = v.pedidoId || v.origen === "pedido" ? ["efectivo", "tarjeta", "bizum"] : ["efectivo", "tarjeta", "glovo"];
  return base.includes(v.formaPago) ? base : [...base, v.formaPago];
}
function htmlTransacciones(ventas, editable) {
  if (!ventas.length) return "";
  const fila = (v) => {
    const togoo = v.saleMode === "togoo";
    const detalle = (v.detalles || []).map((d) => `<li>${esc(String(d.cantidad))}× ${esc(d.productoNombre || "")}${d.opcionNombre ? ` <small class="cal-muted">${esc(d.opcionNombre)}</small>` : ""}</li>`).join("");
    const pago = togoo
      ? `<span class="cal-muted">Too Good To Go</span>`
      : editable
        ? `<select class="cierre-pago-select" data-cambiar-pago="${esc(v.uuid || "")}" data-fecha="${esc(v.fecha || "")}" data-anterior="${esc(v.formaPago)}" aria-label="Forma de pago">${opcionesDePago(v).map((f) => `<option value="${f}"${f === v.formaPago ? " selected" : ""}>${NOMBRE_PAGO[f] || f}</option>`).join("")}</select>`
        : `<span>${NOMBRE_PAGO[v.formaPago] || esc(v.formaPago)}</span>`;
    return `
      <li class="cierre-trans">
        <details>
          <summary><span class="trans-hora">${esc(v.hora || "")}</span><strong class="trans-total">${centsToMoney(v.totalCentavos)}</strong></summary>
          <ul class="trans-detalle">${detalle || `<li class="cal-muted">Sin detalle</li>`}</ul>
        </details>
        <div class="trans-pago">${pago}</div>
      </li>`;
  };
  return `
    <section class="panel-card">
      <details class="cierre-trans-lista"${transAbierto ? " open" : ""}>
      <summary><h2>Transacciones del día <small class="cal-muted">${ventas.length}</small></h2></summary>
      <p class="caja-comentario">${editable ? "Si una venta se cargó con otra forma de pago, cambiala acá. Solo cambia la forma de pago: el total y el stock quedan igual." : "Para corregir una forma de pago, tocá Editar cierre."}</p>
      <ul class="cierre-transacciones">${ventas.map(fila).join("")}</ul>
      </details>
    </section>`;
}
// La lista arranca cerrada; si se abre, sigue abierta al volver a dibujar (ej. despues de corregir un pago).
let transAbierto = false;
function enlazarTransacciones(container) {
  container.querySelectorAll("details.cierre-trans-lista").forEach((d) => d.addEventListener("toggle", () => { transAbierto = d.open; }));
}

// Lo vendido en el dia: informacion global, aparte del cierre de la caja (va despues del boton de cerrar).
function htmlResumenDelDia(cuenta, hay, total, vendido) {
  const otros = cuenta.otrosIngresos;
  return `
    <section class="panel-card">
    <h2>Lo vendido del día <small class="cal-muted">aparte del cierre</small></h2>
    <div class="cierre-otros">
      ${hay ? `
      <div class="cierre-row cierre-row--grande"><span>Dinero total del día <small class="cal-muted">(fondo de caja + efectivo + posnet)</small></span><strong>${centsToMoney(total.real)}</strong></div>
      <div class="cierre-row resta"><span>Apertura <small>(ya estaba en el cajón, no es venta)</small></span><strong>−${centsToMoney(cuenta.apertura.real)}</strong></div>
      ${cuenta.ingresos.real ? `<div class="cierre-row resta"><span>Otros ingresos al cajón <small>(entraron sin ser venta)</small></span><strong>−${centsToMoney(cuenta.ingresos.real)}</strong></div>` : ""}
      ${cuenta.pagos.real ? `<div class="cierre-row"><span>Pagos en efectivo <small class="cal-muted">(salieron del cajón, pero se habían cobrado)</small></span><strong>+${centsToMoney(cuenta.pagos.real)}</strong></div>` : ""}
      ${cuenta.retiros.real ? `<div class="cierre-row"><span>Retiros <small class="cal-muted">(salieron del cajón, pero se habían cobrado)</small></span><strong>+${centsToMoney(cuenta.retiros.real)}</strong></div>` : ""}` : ""}
      <div class="cierre-row cierre-row--total resultado"><span>Vendido en el local ${hay ? "" : `<small class="cal-muted">(según el sistema, falta contar)</small>`}</span><strong>${centsToMoney(vendido)}</strong></div>
      <div class="cierre-row"><span>Glovo y otras plataformas</span><strong>${centsToMoney(otros.glovoCentavos)}</strong></div>
      <div class="cierre-row"><span>Too Good To Go</span><strong>${centsToMoney(otros.tgtgCentavos)}</strong></div>
      <div class="cierre-row"><span>Bizum <small class="cal-muted">(pedidos)</small></span><strong>${centsToMoney(otros.bizumCentavos)}</strong></div>
      <div class="cierre-row"><span>Total de otros ingresos</span><strong>${centsToMoney(otros.totalCentavos)}</strong></div>
    </div>
    <div class="cierre-row cierre-row--total"><span>Facturación total del día</span><strong>${centsToMoney(cuenta.facturacionTotalCentavos)}</strong></div>
    </section>`;
}

// Un dia ya cerrado no se vuelve a cerrar (tampoco desde otro dispositivo): solo se puede "Editar cierre",
// que al guardar queda como version nueva. Aca se anotan las fechas que se estan editando ahora.
const enEdicion = new Set();
export function terminarEdicionCierre(fecha) { enEdicion.delete(fecha); }
export function iniciarEdicionCierre(fecha) { enEdicion.add(fecha); }

// Renderiza la pantalla de cierre. `opciones.historialContainer` (opcional): donde van los
// "Últimos cierres", para que el resumen del dia pueda quedar entre el boton de cerrar y el historial.
export function renderCierre(container, datos, opciones = {}) {
  const base = baseDelCierre(datos);
  const v = base.vigente;
  const sistemaPrevio = cuentaRealVsSistema({
    ventas: datos.ventas,
    fondoCentavos: base.fondoCentavos,
    pagosCentavos: base.pagosCentavos,
    retirosCentavos: base.retirosCentavos,
    ingresosCentavos: base.ingresosCentavos
  });

  const aviso = datos.fuente === "local"
    ? `<p class="panel-aviso">Sin conexión: las ventas vienen de este dispositivo. El cierre se guarda igual y sube solo cuando vuelva internet.</p>` : "";
  const vigenteHtml = v ? `
    <p class="cierre-vigente">Ya hay un cierre de este día (${datos.versiones.length === 1 ? "1 versión" : `${datos.versiones.length} versiones`}, la última a las ${hora(v.creadoEn)}: ${v.diferenciaCentavos === 0 ? "cuadrada" : `diferencia ${centsToMoney(v.diferenciaCentavos)}`}). Si lo guardás de nuevo, queda como versión nueva y el anterior se conserva en el historial.</p>` : "";

  const claseHist = (d) => (d === 0 ? "ok" : Math.abs(d) <= 100 ? "chico" : "grande");
  const historial = datos.historial.length === 0 ? `<p class="panel-empty">Todavía no hay cierres guardados.</p>` : `
    <ul class="cierre-historial">${datos.historial.map((c) => `
      <li>
        <span>${esc(c.fecha.slice(8))}/${esc(c.fecha.slice(5, 7))}</span>
        <span>${centsToMoney(c.ventasTotalCentavos)}</span>
        <span class="cierre-diff-mini is-${claseHist(c.diferenciaCentavos)}">${c.diferenciaCentavos === 0 ? "cuadra" : (c.diferenciaCentavos > 0 ? "+" : "") + centsToMoney(c.diferenciaCentavos)}</span>
        <button type="button" class="ghost-button compact" data-editar-cierre="${esc(c.fecha)}">Editar cierre</button>
      </li>`).join("")}</ul>`;
  const historialHtml = `
    <section class="panel-card">
      <h2>Últimos cierres</h2>
      ${historial}
    </section>`;

  if (v && !enEdicion.has(datos.fecha)) {
    const dif = Number(v.diferenciaCentavos) || 0;
    container.innerHTML = `
      ${aviso}
      <section class="panel-card">
        <h2><span class="caja-paso-num">4</span> Caja cerrada</h2>
        <p class="cierre-vigente">Este día ya se cerró a las ${hora(v.creadoEn)}${datos.versiones.length > 1 ? ` (versión ${datos.versiones.length})` : ""}. No se puede volver a cerrar: si hay algo mal, usá Editar cierre.</p>
        <div class="cierre-otros">
          <div class="cierre-row"><span>Efectivo contado</span><strong>${centsToMoney(v.contadoCentavos)}</strong></div>
          <div class="cierre-row"><span>Posnet</span><strong>${centsToMoney(v.tarjetaCentavos)}</strong></div>
          <div class="cierre-row"><span>Diferencia del efectivo</span><strong>${dif === 0 ? "cuadra" : `${dif > 0 ? "+" : "−"}${centsToMoney(Math.abs(dif))}`}</strong></div>
          ${v.fondoMananaCentavos !== null && v.fondoMananaCentavos !== undefined ? `<div class="cierre-row"><span>Quedó en el cajón para mañana</span><strong>${centsToMoney(v.fondoMananaCentavos)}</strong></div>` : ""}
          ${v.nota ? `<div class="cierre-row"><span>Comentario</span><strong>${esc(v.nota)}</strong></div>` : ""}
        </div>
        <button type="button" class="ghost-button" id="cierre-editar">Editar cierre</button>
      </section>
      <div id="cierre-resumen"></div>
      ${htmlTransacciones(datos.ventas || [], false)}
      ${opciones.historialContainer ? "" : historialHtml}`;
    if (opciones.historialContainer) opciones.historialContainer.innerHTML = historialHtml;
    const cuentaCerrada = cuentaRealVsSistema({
      ventas: datos.ventas, fondoCentavos: base.fondoCentavos, pagosCentavos: base.pagosCentavos,
      retirosCentavos: base.retirosCentavos, ingresosCentavos: base.ingresosCentavos,
      contadoCentavos: v.contadoCentavos, postnetRealCentavos: v.tarjetaCentavos
    });
    renderCuentaEnDosColumnas(document.createElement("div"), cuentaCerrada, container.querySelector("#cierre-resumen"));
    container.oninput = null;
    container.onchange = null;
    enlazarTransacciones(container);
    container.querySelector("#cierre-editar").onclick = () => { enEdicion.add(datos.fecha); renderCierre(container, datos, opciones); };
    return null;
  }

  container.innerHTML = `
    ${aviso}
    <section class="panel-card">
      <h2><span class="caja-paso-num">4</span> ${v ? "Editar el cierre" : "Cerrar el día"}</h2>
      <p class="caja-comentario">Contá la plata y anotá el cierre del posnet. Al lado de cada uno ves lo que dice el sistema.</p>
      <div class="cierre-contar">
        <div class="cierre-contar-fila">
          ${campoDinero("cierre-contado", "Efectivo en caja: ¿cuánto hay? (€)", centavosAInput(v?.contadoCentavos ?? null))}
          <div class="cierre-sistema">
            <span>Por sistema debería haber</span>
            <strong>${centsToMoney(sistemaPrevio.efectivo.sistema)}</strong>
            <small>apertura + cobrado en efectivo − pagos y retiros</small>
            <small class="cierre-coincide" id="cierre-contado-coincide" aria-live="polite" hidden></small>
          </div>
        </div>
        <div class="cierre-contar-fila">
          ${campoDinero("cierre-tarjeta", "Cierre del posnet: ¿cuánto marca? (€)", centavosAInput(v ? v.tarjetaCentavos : null))}
          <div class="cierre-sistema">
            <span>Por sistema entró</span>
            <strong>${centsToMoney(sistemaPrevio.tarjeta.sistema)}</strong>
            <small>solo lo que entra: del posnet no sale nada</small>
            <small class="cierre-coincide" id="cierre-tarjeta-coincide" aria-live="polite" hidden></small>
          </div>
        </div>
      </div>
    </section>

    <section class="panel-card">
      <h2>La cuenta: real contra sistema</h2>
      <div id="cierre-cuenta"></div>
      <div id="cierre-alertas"></div>
      <label class="cierre-field" for="cierre-nota"><span>Comentarios si hay desajuste</span><input type="text" id="cierre-nota" maxlength="200" value="${esc(v?.nota || "")}" placeholder="opcional"></label>
      <div class="cierre-contar">
        ${campoDinero("cierre-fondo-manana", "Dejás en el cajón para mañana (€)", centavosAInput(v ? (v.fondoMananaCentavos ?? null) : base.fondoCentavos), "Opcional. Mañana se propone como apertura.")}
      </div>
      <div id="cierre-retiro-fila" class="cierre-otros" hidden>
        <div class="cierre-row"><span>Efectivo en el cajón <small class="cal-muted">(lo que contaste)</small></span><strong id="cierre-retiro-efectivo"></strong></div>
        <div class="cierre-row resta"><span>Dejás para mañana</span><strong id="cierre-retiro-deja"></strong></div>
        <div class="cierre-row cierre-row--total"><span>Retirás del cajón <small class="cal-muted">(del posnet no se retira nada)</small></span><strong id="cierre-retiro-valor"></strong></div>
      </div>
      ${vigenteHtml}
      <button type="button" class="primary-button" id="cierre-guardar">${v ? "Guardar cambios del cierre" : "Cerrar caja"}</button>
      ${v ? `<button type="button" class="ghost-button" id="cierre-cancelar-edicion">Cancelar</button>` : ""}
    </section>
    <div id="cierre-resumen"></div>
    ${htmlTransacciones(datos.ventas || [], true)}
    ${opciones.historialContainer ? "" : historialHtml}`;
  if (opciones.historialContainer) opciones.historialContainer.innerHTML = historialHtml;

  enlazarTransacciones(container);
  const cuentaEl = container.querySelector("#cierre-cuenta");
  const dato = (id, real, sistema) => {
    const info = container.querySelector(`#${id}`);
    if (!info) return;
    const dif = Number.isFinite(real) ? real - sistema : null;
    info.hidden = dif === null;
    info.classList.toggle("es-ok", dif !== null && dif === 0);
    info.classList.toggle("es-dif", dif !== null && dif !== 0);
    info.textContent = dif === null ? "" : dif === 0 ? "✓ Coincide con el sistema" : `${dif > 0 ? "Sobran" : "Faltan"} ${centsToMoney(Math.abs(dif))} respecto del sistema`;
  };
  const recalcular = () => {
    const r = calcularDesdeFormulario(container, datos);
    renderCuentaEnDosColumnas(cuentaEl, r.cuenta, container.querySelector("#cierre-resumen"));
    container.querySelector("#cierre-alertas").innerHTML = [...r.alertas, r.error].filter(Boolean).map((a) => `<p class="cierre-alerta">⚠ ${esc(a)}</p>`).join("");
    container.querySelectorAll("input[data-money]").forEach((i) => i.setAttribute("aria-invalid", Number.isNaN(parseEuros(i.value)) ? "true" : "false"));
    container.querySelector("#cierre-guardar").disabled = Boolean(r.error);
    dato("cierre-contado-coincide", r.cuenta.efectivo.real, r.cuenta.efectivo.sistema);
    dato("cierre-tarjeta-coincide", r.cuenta.tarjeta.real, r.cuenta.tarjeta.sistema);
    const { contadoCentavos: cont, fondoMananaCentavos: deja } = r.form;
    const fila = container.querySelector("#cierre-retiro-fila");
    const hay = Number.isFinite(cont) && Number.isFinite(deja);
    fila.hidden = !hay;
    if (hay) {
      container.querySelector("#cierre-retiro-efectivo").textContent = centsToMoney(cont);
      container.querySelector("#cierre-retiro-deja").textContent = "−" + centsToMoney(deja);
      container.querySelector("#cierre-retiro-valor").textContent = centsToMoney(Math.max(0, cont - deja));
    }
    return r;
  };
  const cancelar = container.querySelector("#cierre-cancelar-edicion");
  if (cancelar) cancelar.onclick = () => { enEdicion.delete(datos.fecha); renderCierre(container, datos, opciones); };
  container.oninput = recalcular;
  container.onchange = recalcular;
  return recalcular();
}
