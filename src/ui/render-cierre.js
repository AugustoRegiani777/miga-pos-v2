import { centsToMoney } from "../utils/format.js";
import { calcularCierre, parseEuros, centavosAInput, desgloseFormaPago, armarCierreAutomatico } from "../modules/cierre-calculos.js";

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

// Lee el formulario. null = vacio, NaN = importe invalido.
export function leerFormularioCierre(container) {
  const dinero = (id) => parseEuros(container.querySelector(`#${id}`)?.value);
  return {
    fondoCentavos: dinero("cierre-fondo"),
    tarjetaCentavos: dinero("cierre-tarjeta"),
    plataformasCentavos: dinero("cierre-plataformas"),
    retirosCentavos: dinero("cierre-retiros"),
    contadoCentavos: dinero("cierre-contado"),
    fondoMananaCentavos: dinero("cierre-fondo-manana"),
    retirosNota: container.querySelector("#cierre-retiros-nota")?.value.trim() || "",
    nota: container.querySelector("#cierre-nota")?.value.trim() || "",
    tgtgEnCajon: Boolean(container.querySelector("#cierre-tgtg-cajon")?.checked)
  };
}

const limpio = (v) => (v === null || Number.isNaN(v) ? null : v);
const aCero = (v) => (v === null || Number.isNaN(v) ? 0 : v);

// Calcula con lo que hay en el formulario ahora mismo. `error` explica por que no se puede guardar.
export function calcularDesdeFormulario(container, ventas) {
  const f = leerFormularioCierre(container);
  const invalidos = ["fondoCentavos", "tarjetaCentavos", "plataformasCentavos", "retirosCentavos", "contadoCentavos", "fondoMananaCentavos"].filter((k) => Number.isNaN(f[k]));
  const calculo = calcularCierre({
    ventas,
    fondoCentavos: aCero(f.fondoCentavos),
    tarjetaCentavos: aCero(f.tarjetaCentavos),
    plataformasCentavos: aCero(f.plataformasCentavos),
    retirosCentavos: aCero(f.retirosCentavos),
    contadoCentavos: limpio(f.contadoCentavos),
    fondoMananaCentavos: limpio(f.fondoMananaCentavos),
    tgtgEnCajon: f.tgtgEnCajon
  });
  let error = "";
  if (invalidos.length) error = "Hay un importe que no se entiende. Usá números, por ejemplo 12,50.";
  else if (f.tarjetaCentavos === null) error = "Anotá el total de tarjeta del cierre de Postnet (0 si no hubo).";
  else if (f.contadoCentavos === null) error = "Anotá cuánto efectivo contaste.";
  return { form: f, calculo, error, invalidos };
}

const fila = (texto, valor, clase = "") => `<div class="cierre-row ${clase}"><span>${texto}</span><strong>${valor}</strong></div>`;

export function renderResultadoCierre(el, { calculo: c, error, form }, ctx = {}) {
  const etiquetaDif = c.nivel === null ? "Falta contar el efectivo"
    : c.nivel === "ok" ? "Caja cuadrada ✓"
    : c.diferenciaCentavos > 0 ? `Sobran ${centsToMoney(c.diferenciaCentavos)}`
    : `Faltan ${centsToMoney(-c.diferenciaCentavos)}`;
  const plataformas = aCero(form.plataformasCentavos);
  const tickets = ctx.tickets ?? c.tickets;
  // Lo que se quedo en el local: lo que entro por Postnet y por el cajon. Glovo (y otras
  // plataformas) y los paquetes de Too Good To Go que cobra la app no pasan por el local.
  const cierreLocalCentavos = c.ventasTotalCentavos - plataformas - c.tgtgFueraDelCajon;
  el.innerHTML = `
    ${fila(`Ventas del sistema <small>${tickets} ticket${tickets === 1 ? "" : "s"}</small>`, centsToMoney(c.ventasTotalCentavos), "is-sub")}
    ${fila("Postnet (tarjeta)", centsToMoney(aCero(form.tarjetaCentavos)), "is-detalle")}
    ${fila("Efectivo", centsToMoney(c.efectivoDeVentasCentavos), "is-detalle")}
    ${plataformas > 0 ? fila("Glovo y otras plataformas", centsToMoney(plataformas), "is-detalle") : ""}
    ${c.tgtgFueraDelCajon ? fila("Too Good To Go (lo cobra la app)", centsToMoney(c.tgtgFueraDelCajon), "is-detalle") : ""}
    ${fila("Retiros (pagos y retiros de efectivo)", `− ${centsToMoney(aCero(form.retirosCentavos))}`, "is-minus")}
    ${fila("Facturación del día", centsToMoney(c.ventasTotalCentavos), "is-total")}
    ${fila("Cierre del día local", centsToMoney(cierreLocalCentavos), "is-total")}
    <div class="cierre-control">
      ${fila("Debería haber en el cajón", centsToMoney(c.esperadoEfectivoCentavos))}
      ${fila("Efectivo real en caja", c.diferenciaCentavos === null ? "—" : centsToMoney(form.contadoCentavos))}
    </div>
    <div class="cierre-diff is-${c.nivel || "pendiente"}" role="status">${etiquetaDif}</div>
    ${c.retiraCentavos !== null ? `<p class="cierre-nota">Al cerrar sacás del cajón <strong>${centsToMoney(c.retiraCentavos)}</strong> y dejás <strong>${centsToMoney(form.fondoMananaCentavos)}</strong> para mañana.</p>` : ""}
    ${[...c.alertas, error].filter(Boolean).map((a) => `<p class="cierre-alerta">⚠ ${esc(a)}</p>`).join("")}`;
}

const mas = (c) => `+ ${centsToMoney(c)}`;
const menos = (c) => `− ${centsToMoney(c)}`;

// "Pago · hielo" / "Retiro · al banco", uno por renglon, con su importe.
function detalleDeSalidas(salidas, notaGuardada) {
  if (salidas.length) {
    return `<ul class="cierre-detalle-lista">${salidas.map((x) => `
      <li><span>${x.tipo === "retiro" ? "Retiro · " : ""}${esc(x.concepto)}</span><strong>${centsToMoney(x.centavos)}</strong></li>`).join("")}</ul>`;
  }
  return notaGuardada
    ? `<p class="cierre-sin-salidas">${esc(notaGuardada)}</p>`
    : `<p class="cierre-sin-salidas">Sin pagos ni retiros en efectivo hoy.</p>`;
}

// Renderiza la pantalla de cierre. `opciones.historialContainer` (opcional): donde van los
// "Últimos cierres", para que el resumen del dia pueda quedar entre el boton de cerrar y el historial.
export function renderCierre(container, datos, opciones = {}) {
  const v = datos.vigente;
  // Lo que el sistema ya sabe del dia (apertura, tarjeta, Glovo, pagos y retiros). Si ya hay
  // un cierre guardado se muestra ESE: nunca se pisa con lo calculado.
  const auto = armarCierreAutomatico({
    ventas: datos.ventas,
    apertura: datos.caja?.apertura || null,
    movimientos: datos.caja?.movimientos || [],
    fondoSugeridoCentavos: datos.fondoSugeridoCentavos
  });
  const fondo = v ? v.fondoInicialCentavos : auto.fondoCentavos;
  const tgtg = datos.ventas.filter((x) => x.saleMode === "togoo");
  const tgtgTotal = tgtg.reduce((s, x) => s + (x.totalCentavos || 0), 0);
  const sistema = desgloseFormaPago(datos.ventas);
  const salidasValor = v ? (v.retirosCentavos ?? 0) : auto.retirosCentavos;
  const notaSalidas = v ? (v.retirosNota || auto.retirosNota) : auto.retirosNota;

  const aviso = datos.fuente === "local"
    ? `<p class="panel-aviso">Sin conexión: las ventas vienen de este dispositivo. El cierre se guarda igual y sube solo cuando vuelva internet.</p>` : "";
  const vigenteHtml = v ? `
    <p class="cierre-vigente">Ya hay un cierre de este día (${datos.versiones.length === 1 ? "1 versión" : `${datos.versiones.length} versiones`}, la última a las ${hora(v.creadoEn)}: ${v.diferenciaCentavos === 0 ? "cuadrada" : `diferencia ${centsToMoney(v.diferenciaCentavos)}`}). Si lo guardás de nuevo, queda como versión nueva y el anterior se conserva en el historial.</p>` : "";

  const claseDif = (d) => (d === 0 ? "ok" : Math.abs(d) <= 100 ? "chico" : "grande");
  const historial = datos.historial.length === 0 ? `<p class="panel-empty">Todavía no hay cierres guardados.</p>` : `
    <ul class="cierre-historial">${datos.historial.map((c) => `
      <li>
        <span>${esc(c.fecha.slice(8))}/${esc(c.fecha.slice(5, 7))}</span>
        <span>${centsToMoney(c.ventasTotalCentavos)}</span>
        <span class="cierre-diff-mini is-${claseDif(c.diferenciaCentavos)}">${c.diferenciaCentavos === 0 ? "cuadra" : (c.diferenciaCentavos > 0 ? "+" : "") + centsToMoney(c.diferenciaCentavos)}</span>
      </li>`).join("")}</ul>`;
  const historialHtml = `
    <section class="panel-card">
      <h2>Últimos cierres</h2>
      ${historial}
    </section>`;

  // El cierre se arma SOLO con lo que se anoto durante el dia, sin boton: quien cierra
  // chequea, corrige lo que no coincida, y cuenta el efectivo (lo unico que el sistema
  // no puede ni debe saber).
  //
  // Orden: la plata que hubo (fondo + ingresos), lo que se fue (plataformas + salidas, con su
  // detalle uno por renglon), y al final lo que cuenta la persona: el efectivo real y el
  // total de Postnet. "Ingresos" y "Salidas" no se tipean: salen de las ventas y de los pagos y
  // retiros anotados, y se muestran calculados.
  container.innerHTML = `
    ${aviso}
    <section class="panel-card">
      <h2><span class="caja-paso-num">4</span> Cerrar el día</h2>
      <div class="cierre-grid">
        ${campoDinero("cierre-fondo", "Fondo con el que abriste (€)", centavosAInput(fondo ?? 0), v ? "" : (datos.caja?.apertura && !datos.caja.apertura.implicita ? "Es el que anotaste al abrir la caja." : "Propuesto: lo que dejaste en el último cierre."))}
        <div class="cierre-calculado">
          <span>Ingresos en efectivo</span>
          <strong class="es-mas">${mas(auto.efectivoSistemaCentavos)}</strong>
          <small>Se suma con cada venta cobrada en efectivo.</small>
        </div>
        ${campoDinero("cierre-plataformas", "Glovo y otras plataformas (€)", centavosAInput(v ? (v.plataformasCentavos ?? null) : (auto.plataformasCentavos || null)), "Lo que cobra la plataforma. No cuenta como efectivo.")}
        <div class="cierre-calculado">
          <span>Ingresos con tarjeta (Postnet)</span>
          <strong class="es-mas">${mas(auto.tarjetaCentavos)}</strong>
          <small>Lo que anotó la Caja en tarjeta. Abajo va el total del cierre de Postnet, que es el que manda.</small>
        </div>
        <div class="cierre-calculado cierre-ancho">
          <span>Salidas de efectivo</span>
          <strong class="es-menos">${menos(salidasValor)}</strong>
          <small>Pagos y retiros que anotaste en el día.</small>
        </div>
        <div class="cierre-detalle cierre-ancho">
          <h3>Detalle de las salidas</h3>
          ${detalleDeSalidas(auto.salidas, notaSalidas)}
        </div>
        ${campoDinero("cierre-contado", "Efectivo real en caja (€)", centavosAInput(v?.contadoCentavos ?? null), `<small class="cierre-coincide" id="cierre-contado-coincide" aria-live="polite" hidden></small>`)}
        ${campoDinero("cierre-tarjeta", "Cierre de Postnet · tarjeta (€)", centavosAInput(v ? v.tarjetaCentavos : auto.tarjetaCentavos), `El total del cierre de Postnet: es el que manda. <small class="cierre-coincide" id="cierre-tarjeta-coincide" aria-live="polite" hidden></small>`)}
        ${campoDinero("cierre-fondo-manana", "Dejás en el cajón para mañana (€)", centavosAInput(v ? (v.fondoMananaCentavos ?? null) : auto.fondoMananaCentavos), "Opcional. Mañana se propone como fondo.")}
      </div>
      <!-- Lo que se calcula solo y se guarda con el cierre: no se ve como campo. -->
      <input type="hidden" id="cierre-retiros" data-money value="${esc(centavosAInput(salidasValor > 0 ? salidasValor : null))}">
      <input type="hidden" id="cierre-retiros-nota" value="${esc(notaSalidas || "")}">
    </section>

    <section class="panel-card">
      <h2>Resultado</h2>
      <div id="cierre-resultado" class="cierre-resultado"></div>
      ${tgtg.length ? `
        <label class="cierre-check">
          <input type="checkbox" id="cierre-tgtg-cajon" ${v?.tgtgEnCajon ? "checked" : ""}>
          <span>Too Good To Go: ${tgtg.length} paquete${tgtg.length > 1 ? "s" : ""} (${centsToMoney(tgtgTotal)}). Marcá si se cobró en el local; si lo cobra la app no entra al cajón.</span>
        </label>` : ""}
      <label class="cierre-field" for="cierre-nota"><span>Comentarios si hay desajuste</span><input type="text" id="cierre-nota" maxlength="200" value="${esc(v?.nota || "")}" placeholder="opcional"></label>
      ${vigenteHtml}
      <button type="button" class="primary-button" id="cierre-guardar">Cerrar caja</button>
    </section>
    ${opciones.historialContainer ? "" : historialHtml}`;
  if (opciones.historialContainer) opciones.historialContainer.innerHTML = historialHtml;

  const resultado = container.querySelector("#cierre-resultado");
  let esperadoActual = null;
  const recalcular = () => {
    const r = calcularDesdeFormulario(container, datos.ventas);
    // Cruce contra lo que se tapeo en la Caja — solo un aviso, nunca cambia el calculo: el
    // numero que manda es el que se escribe a mano del cierre de Postnet.
    if (r.form.tarjetaCentavos !== null && !Number.isNaN(r.form.tarjetaCentavos) && Math.abs(r.form.tarjetaCentavos - sistema.tarjetaCentavos) > 1) {
      r.calculo.alertas.push(`La Caja registró ${centsToMoney(sistema.tarjetaCentavos)} en tarjeta; anotaste ${centsToMoney(r.form.tarjetaCentavos)}. Puede ser normal (propinas, redondeo) — si no, revisá el cierre de Postnet.`);
    }
    renderResultadoCierre(resultado, r, { tickets: datos.ventas.length });
    container.querySelectorAll("input[data-money]").forEach((i) => i.setAttribute("aria-invalid", Number.isNaN(parseEuros(i.value)) ? "true" : "false"));
    container.querySelector("#cierre-guardar").disabled = Boolean(r.error);
    // Dato al lado del campo (no un boton): lo que el sistema dice que deberia haber, y si lo
    // contado coincide o cuanto se aleja. La persona sigue contando y escribiendo.
    const info = container.querySelector("#cierre-contado-coincide");
    esperadoActual = r.calculo.esperadoEfectivoCentavos;
    if (info) {
      info.hidden = !(esperadoActual >= 0);
      const contado = r.form.contadoCentavos;
      const dif = Number.isFinite(contado) ? contado - esperadoActual : null;
      info.classList.toggle("es-ok", dif !== null && Math.abs(dif) <= 1);
      info.classList.toggle("es-dif", dif !== null && Math.abs(dif) > 1);
      info.textContent = dif === null
        ? `Según el sistema debería haber ${centsToMoney(esperadoActual)}`
        : Math.abs(dif) <= 1
          ? `✓ Coincide con el sistema (${centsToMoney(esperadoActual)})`
          : `Sistema: ${centsToMoney(esperadoActual)} · ${dif > 0 ? "sobran" : "faltan"} ${centsToMoney(Math.abs(dif))}`;
    }
    // Lo mismo para la tarjeta: lo que anoto la Caja contra el total de Postnet que se escribe.
    const infoT = container.querySelector("#cierre-tarjeta-coincide");
    if (infoT) {
      const sist = sistema.tarjetaCentavos;
      const tarj = r.form.tarjetaCentavos;
      const difT = Number.isFinite(tarj) ? tarj - sist : null;
      infoT.hidden = false;
      infoT.classList.toggle("es-ok", difT !== null && Math.abs(difT) <= 1);
      infoT.classList.toggle("es-dif", difT !== null && Math.abs(difT) > 1);
      infoT.textContent = difT === null
        ? `Según el sistema entró ${centsToMoney(sist)}`
        : Math.abs(difT) <= 1
          ? `✓ Coincide con el sistema (${centsToMoney(sist)})`
          : `Sistema: ${centsToMoney(sist)} · ${difT > 0 ? "sobran" : "faltan"} ${centsToMoney(Math.abs(difT))}`;
    }
    return r;
  };
  const poner = (id, texto) => { const el = container.querySelector(`#${id}`); if (el) el.value = texto; };
  container.oninput = recalcular;
  container.onchange = recalcular;
  return recalcular();
}
