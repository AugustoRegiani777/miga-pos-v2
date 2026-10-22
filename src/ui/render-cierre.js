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
  return `<td class="dif"><span class="cierre-diff-mini is-${claseDif(d)}">${texto}</span></td>`;
};
const euro = (n) => (n === null || n === undefined ? "—" : centsToMoney(n));

function filaCuenta(texto, c, { signo = "", dif = true, clase = "" } = {}) {
  return `
    <tr class="${clase}">
      <th scope="row">${signo ? `<span class="signo">${signo}</span> ` : ""}${texto}</th>
      <td>${euro(c.real)}</td>
      <td>${euro(c.sistema)}</td>
      ${dif ? celdaDif(c.diferencia) : `<td class="dif"></td>`}
    </tr>`;
}

export function renderCuentaEnDosColumnas(el, cuenta) {
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
      <thead><tr><th></th><th>Real <small>(lo que contaste)</small></th><th>Sistema <small>(lo registrado)</small></th><th>Dif.</th></tr></thead>
      <tbody>
        ${filaCuenta("Efectivo en caja", cuenta.efectivo)}
        ${filaCuenta("Posnet (tarjeta)", cuenta.tarjeta)}
        ${filaCuenta("Total", total, { clase: "es-total" })}
      </tbody>
    </table>
    <h3 class="cierre-otros-titulo">Resumen del día <small class="cal-muted">lo vendido, aparte del cierre</small></h3>
    <div class="cierre-otros">
      <div class="cierre-row"><span>Vendido en el local <small class="cal-muted">(efectivo + posnet, sin la apertura)</small></span><strong>${centsToMoney(vendido)}</strong></div>
      <div class="cierre-row"><span>Glovo y otras plataformas</span><strong>${centsToMoney(otros.glovoCentavos)}</strong></div>
      <div class="cierre-row"><span>Too Good To Go</span><strong>${centsToMoney(otros.tgtgCentavos)}</strong></div>
      <div class="cierre-row"><span>Bizum <small class="cal-muted">(pedidos)</small></span><strong>${centsToMoney(otros.bizumCentavos)}</strong></div>
      <div class="cierre-row"><span>Total de otros ingresos</span><strong>${centsToMoney(otros.totalCentavos)}</strong></div>
    </div>
    <div class="cierre-row cierre-row--total"><span>Facturación total del día</span><strong>${centsToMoney(cuenta.facturacionTotalCentavos)}</strong></div>`;
}

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
      </li>`).join("")}</ul>`;
  const historialHtml = `
    <section class="panel-card">
      <h2>Últimos cierres</h2>
      ${historial}
    </section>`;

  container.innerHTML = `
    ${aviso}
    <section class="panel-card">
      <h2><span class="caja-paso-num">4</span> Cerrar el día</h2>
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
      <div class="cierre-row" id="cierre-retiro-fila" hidden><span>Retirás del cajón <small class="cal-muted">(lo contado − lo que dejás)</small></span><strong id="cierre-retiro-valor"></strong></div>
      ${vigenteHtml}
      <button type="button" class="primary-button" id="cierre-guardar">Cerrar caja</button>
    </section>
    ${opciones.historialContainer ? "" : historialHtml}`;
  if (opciones.historialContainer) opciones.historialContainer.innerHTML = historialHtml;

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
    renderCuentaEnDosColumnas(cuentaEl, r.cuenta);
    container.querySelector("#cierre-alertas").innerHTML = [...r.alertas, r.error].filter(Boolean).map((a) => `<p class="cierre-alerta">⚠ ${esc(a)}</p>`).join("");
    container.querySelectorAll("input[data-money]").forEach((i) => i.setAttribute("aria-invalid", Number.isNaN(parseEuros(i.value)) ? "true" : "false"));
    container.querySelector("#cierre-guardar").disabled = Boolean(r.error);
    dato("cierre-contado-coincide", r.cuenta.efectivo.real, r.cuenta.efectivo.sistema);
    dato("cierre-tarjeta-coincide", r.cuenta.tarjeta.real, r.cuenta.tarjeta.sistema);
    const { contadoCentavos: cont, fondoMananaCentavos: deja } = r.form;
    const fila = container.querySelector("#cierre-retiro-fila");
    const hay = Number.isFinite(cont) && Number.isFinite(deja);
    fila.hidden = !hay;
    if (hay) container.querySelector("#cierre-retiro-valor").textContent = centsToMoney(Math.max(0, cont - deja));
    return r;
  };
  container.oninput = recalcular;
  container.onchange = recalcular;
  return recalcular();
}
