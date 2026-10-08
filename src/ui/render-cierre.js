import { centsToMoney } from "../utils/format.js";
import { calcularCierre, parseEuros, centavosAInput, desgloseFormaPago } from "../modules/cierre-calculos.js";

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

export function renderResultadoCierre(el, { calculo: c, error, form }) {
  const menos = (cent) => `− ${centsToMoney(cent)}`;
  const etiquetaDif = c.nivel === null ? "Falta contar el efectivo"
    : c.nivel === "ok" ? "Caja cuadrada ✓"
    : c.diferenciaCentavos > 0 ? `Sobran ${centsToMoney(c.diferenciaCentavos)}`
    : `Faltan ${centsToMoney(-c.diferenciaCentavos)}`;
  el.innerHTML = `
    ${fila("Ventas del sistema", centsToMoney(c.ventasTotalCentavos))}
    ${c.tgtgFueraDelCajon ? fila("Too Good To Go (lo cobra la app)", menos(c.tgtgFueraDelCajon), "is-minus") : ""}
    ${fila("Tarjeta (Postnet)", menos(aCero(form.tarjetaCentavos)), "is-minus")}
    ${aCero(form.plataformasCentavos) > 0 ? fila("Plataformas (Glovo…)", menos(form.plataformasCentavos), "is-minus") : ""}
    ${fila("= Efectivo que entró por ventas", centsToMoney(c.efectivoDeVentasCentavos), "is-sub")}
    ${fila("+ Fondo con el que abriste", centsToMoney(aCero(form.fondoCentavos)))}
    ${aCero(form.retirosCentavos) > 0 ? fila("− Retiros del cajón", menos(form.retirosCentavos), "is-minus") : ""}
    ${fila("= Debería haber en el cajón", centsToMoney(c.esperadoEfectivoCentavos), "is-total")}
    ${fila("Efectivo contado", c.diferenciaCentavos === null ? "—" : centsToMoney(form.contadoCentavos))}
    <div class="cierre-diff is-${c.nivel || "pendiente"}" role="status">${etiquetaDif}</div>
    ${c.retiraCentavos !== null ? `<p class="cierre-nota">Al cerrar sacás del cajón <strong>${centsToMoney(c.retiraCentavos)}</strong> y dejás <strong>${centsToMoney(form.fondoMananaCentavos)}</strong> para mañana.</p>` : ""}
    ${[...c.alertas, error].filter(Boolean).map((a) => `<p class="cierre-alerta">⚠ ${esc(a)}</p>`).join("")}`;
}

export function renderCierre(container, datos) {
  const v = datos.vigente;
  const fondo = v ? v.fondoInicialCentavos : datos.fondoSugeridoCentavos;
  const ventasTotal = datos.ventas.reduce((s, x) => s + (x.totalCentavos || 0), 0);
  const tgtg = datos.ventas.filter((x) => x.saleMode === "togoo");
  const tgtgTotal = tgtg.reduce((s, x) => s + (x.totalCentavos || 0), 0);
  const sistema = desgloseFormaPago(datos.ventas);

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

  container.innerHTML = `
    ${aviso}
    <section class="panel-card">
      <h2><span class="caja-paso-num">4</span> Cerrar el día</h2>
      <div class="cierre-form">
        ${campoDinero("cierre-fondo", "Fondo con el que abriste (€)", centavosAInput(fondo ?? 0), datos.fondoSugeridoCentavos !== null && !v ? "Propuesto: lo que dejaste en el último cierre." : "")}
        ${campoDinero("cierre-tarjeta", "Tarjeta: total del cierre de Postnet (€)", centavosAInput(v?.tarjetaCentavos ?? null), "Si no hubo ventas con tarjeta, poné 0.")}
        ${campoDinero("cierre-plataformas", "Plataformas (Glovo…) que cobra la plataforma (€)", centavosAInput(v?.plataformasCentavos ?? null), "Opcional. No cuenta como efectivo.")}
        ${campoDinero("cierre-retiros", "Retiros del cajón (€)", centavosAInput(v?.retirosCentavos ?? null), "Opcional. Plata que sacaste durante el día.")}
        <label class="cierre-field" for="cierre-retiros-nota"><span>Para qué fueron los retiros</span><input type="text" id="cierre-retiros-nota" maxlength="120" value="${esc(v?.retirosNota || "")}" placeholder="proveedor, compra…"></label>
        ${campoDinero("cierre-contado", "Efectivo contado ahora (€)", centavosAInput(v?.contadoCentavos ?? null))}
        ${campoDinero("cierre-fondo-manana", "Dejás en el cajón para mañana (€)", centavosAInput(v?.fondoMananaCentavos ?? null), "Opcional. Mañana se propone como fondo.")}
        <label class="cierre-field" for="cierre-nota"><span>Nota del cierre</span><input type="text" id="cierre-nota" maxlength="200" value="${esc(v?.nota || "")}" placeholder="opcional"></label>
      </div>
    </section>

    <section class="panel-card">
      <h2>Resultado</h2>
      <div id="cierre-resultado" class="cierre-resultado"></div>
      ${vigenteHtml}
      <button type="button" class="primary-button" id="cierre-guardar">Cerrar caja</button>
    </section>

    <section class="panel-card">
      <h2>Ventas del sistema</h2>
      <div class="cierre-ventas">
        <div><small>Total del día</small><strong>${centsToMoney(ventasTotal)}</strong></div>
        <div><small>Tickets</small><strong>${datos.ventas.length}</strong></div>
      </div>
      <p class="cierre-nota">Según cómo se cobró cada venta en la Caja: 💵 ${centsToMoney(sistema.efectivoCentavos)} · 💳 ${centsToMoney(sistema.tarjetaCentavos)}. Es solo una referencia: el total real de tarjeta es el del cierre de Postnet, de abajo.</p>
      ${tgtg.length ? `
        <label class="cierre-check">
          <input type="checkbox" id="cierre-tgtg-cajon" ${v?.tgtgEnCajon ? "checked" : ""}>
          <span>Too Good To Go: ${tgtg.length} paquete${tgtg.length > 1 ? "s" : ""} (${centsToMoney(tgtgTotal)}). Marcá si se cobró en el local; si lo cobra la app no entra al cajón.</span>
        </label>` : ""}
    </section>

    <section class="panel-card">
      <h2>Últimos cierres</h2>
      ${historial}
    </section>`;

  const resultado = container.querySelector("#cierre-resultado");
  const recalcular = () => {
    const r = calcularDesdeFormulario(container, datos.ventas);
    // Cruce contra lo que se tapeo en la Caja (ver nota "Segun como se cobro"
    // arriba) — solo un aviso, nunca cambia el calculo: el numero que manda
    // es el que se escribe a mano del cierre de Postnet.
    if (r.form.tarjetaCentavos !== null && !Number.isNaN(r.form.tarjetaCentavos) && Math.abs(r.form.tarjetaCentavos - sistema.tarjetaCentavos) > 1) {
      r.calculo.alertas.push(`La Caja registró ${centsToMoney(sistema.tarjetaCentavos)} en tarjeta; anotaste ${centsToMoney(r.form.tarjetaCentavos)}. Puede ser normal (propinas, redondeo) — si no, revisá el cierre de Postnet.`);
    }
    renderResultadoCierre(resultado, r);
    container.querySelectorAll("input[data-money]").forEach((i) => i.setAttribute("aria-invalid", Number.isNaN(parseEuros(i.value)) ? "true" : "false"));
    container.querySelector("#cierre-guardar").disabled = Boolean(r.error);
    return r;
  };
  container.oninput = recalcular;
  container.onchange = recalcular;
  return recalcular();
}
