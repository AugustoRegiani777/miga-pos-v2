// El Cierre, ordenado como transcurre el día del operador.
//
// Antes la pantalla estaba organizada por estructura del dato: un formulario
// con todos los campos juntos al final del día, y había que acordarse de todo.
// El dueño lo pidió al revés, y tiene razón: apertura → pagos → retiros →
// cierre. Cada paso se hace cuando pasa, y el último llega casi lleno.
//
// Los pasos que ya están hechos se muestran resueltos y compactos; el que toca
// ahora, abierto. Así la pantalla dice sola en qué punto del día estás.

import { centsToMoney } from "../utils/format.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const hora = (iso) => String(iso || "").slice(11, 16);

function paso(n, titulo, estado, cuerpo, accion = "") {
  return `
    <section class="caja-paso caja-paso--${estado}">
      <div class="caja-paso-head">
        <span class="caja-paso-num">${n}</span>
        <h2>${esc(titulo)}</h2>
        ${accion}
      </div>
      <div class="caja-paso-body">${cuerpo}</div>
    </section>`;
}

// ---------------------------------------------------------------- 1. abrir
export function renderPasoApertura(container, { apertura }) {
  const abierta = apertura && !apertura.implicita;
  container.innerHTML = paso(
    1,
    "Apertura",
    abierta ? "hecho" : "ahora",
    abierta
      ? `<p class="caja-paso-resuelto">Abriste con <strong>${centsToMoney(apertura.fondoInicialCentavos)}</strong>${apertura.abiertaEn ? ` a las ${hora(apertura.abiertaEn)}` : ""}.</p>`
      : `<p class="form-instruccion">Contá la plata que hay en el cajón antes de empezar. Es el punto de partida de todo lo demás.</p>
         <div class="caja-paso-form">
           <label class="quantity-field">
             <span>¿Con cuánta plata abrís? (€)</span>
             <input id="caja-apertura-monto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00">
           </label>
           <button class="primary-button" type="button" id="caja-abrir">Abrir caja</button>
         </div>`,
    abierta ? `<button class="ghost-button compact" type="button" id="caja-corregir-apertura">Corregir</button>` : ""
  );
}

// ----------------------------------------------------------------- 2. pagos
export function renderPasoPagos(container, { pagos, totalCentavos }) {
  const lista = pagos.length === 0
    ? `<p class="empty-state">Todavía no anotaste ningún pago.</p>`
    : pagos.map((m) => `
        <div class="caja-mov-fila${m.anulado ? " anulado" : ""}">
          <div class="mov-motivo">
            <strong>${esc(m.motivo)}</strong>
            <div class="cal-muted">${hora(m.ocurridoEn)}${m.afectaCajon === false ? " · con tarjeta" : " · en efectivo"}</div>
          </div>
          <span class="mov-importe sale">−${centsToMoney(Math.abs(Number(m.importeCentavos) || 0))}</span>
          ${m.anulado ? "" : `<button type="button" class="ghost-button compact" data-anular="${esc(m.uuid)}">Anular</button>`}
        </div>`).join("");

  container.innerHTML = paso(
    2,
    "Pagos",
    pagos.length > 0 ? "hecho" : "pendiente",
    `<p class="form-instruccion">Anotá lo que pagues <strong>cuando lo pagás</strong>: a quién, qué compraste y si fue en efectivo o con tarjeta.</p>
     ${lista}
     ${pagos.length > 0 ? `<div class="caja-mov-total"><span>Pagaste hoy</span><span class="mov-importe sale">${centsToMoney(totalCentavos)}</span></div>` : ""}`,
    `<button class="primary-button compact" type="button" id="caja-nuevo-pago">+ Anoté un pago</button>`
  );
}

// --------------------------------------------------------------- 3. retiros
export function renderPasoRetiros(container, { retiros, foto }) {
  const lista = retiros.length === 0
    ? `<p class="empty-state">No sacaste plata del cajón hoy.</p>`
    : retiros.map((m) => `
        <div class="caja-mov-fila${m.anulado ? " anulado" : ""}">
          <div class="mov-motivo">
            <strong>${esc(m.motivo)}</strong>
            <div class="cal-muted">${hora(m.ocurridoEn)}</div>
          </div>
          <span class="mov-importe sale">−${centsToMoney(Math.abs(Number(m.importeCentavos) || 0))}</span>
          ${m.anulado ? "" : `<button type="button" class="ghost-button compact" data-anular="${esc(m.uuid)}">Anular</button>`}
        </div>`).join("");

  // El mini cierre: de dónde sale lo que debería haber. Sin este desglose el
  // número es una afirmación que no se puede discutir.
  const cuenta = foto ? `
    <div class="caja-cuenta">
      <div class="cierre-row"><span>Abriste con</span><strong>${centsToMoney(foto.fondoCentavos)}</strong></div>
      <div class="cierre-row"><span>Cobraste en efectivo</span><strong>+${centsToMoney(foto.ventasEfectivoCentavos)}</strong></div>
      <div class="cierre-row"><span>Pagos y retiros</span><strong>${centsToMoney(foto.movimientosCentavos)}</strong></div>
      <div class="cierre-row cierre-row--total"><span>Debería haber en el cajón</span><strong>${centsToMoney(foto.esperadoCentavos)}</strong></div>
    </div>` : "";

  container.innerHTML = paso(
    3,
    "Retiros",
    retiros.length > 0 ? "hecho" : "pendiente",
    `<p class="form-instruccion">Si sacás plata durante el día, anotalo acá y mirá cómo queda el cajón.</p>
     ${cuenta}
     ${lista}`,
    `<button class="ghost-button compact" type="button" id="caja-nuevo-retiro">Retiré plata</button>`
  );
}
