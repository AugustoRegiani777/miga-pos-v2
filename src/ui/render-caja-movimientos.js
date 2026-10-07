// La lista de lo que se anotó hoy, dentro del Cierre.
//
// Los anulados NO se esconden: quedan tachados. Hacer desaparecer una fila
// deja a quien mira con la duda de "¿no había cargado algo?", y encima tapa el
// error en vez de mostrarlo. Tachado se entiende solo.

import { centsToMoney } from "../utils/format.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ETIQUETA = { gasto: "Pagué", retiro: "Saqué", ingreso: "Entró", ajuste: "Ajuste" };

export function renderMovimientosCaja(container, { movimientos, totales, soloLectura = false }) {
  if (!movimientos || movimientos.length === 0) {
    container.innerHTML = '<p class="empty-state">Todavía no anotaste nada hoy.</p>';
    return;
  }

  const filas = movimientos.map((m) => {
    const importe = Number(m.importeCentavos) || 0;
    const sale = importe < 0;
    const hora = String(m.ocurridoEn || "").slice(11, 16);
    return `
      <div class="caja-mov-fila${m.anulado ? " anulado" : ""}" data-uuid="${esc(m.uuid)}">
        <div class="mov-motivo">
          <strong>${esc(m.motivo)}</strong>
          <div class="cal-muted">${esc(ETIQUETA[m.tipo] || m.tipo)}${hora ? ` · ${hora}` : ""}${m.categoria ? ` · ${esc(m.categoria)}` : ""}${m.afectaCajon === false ? " · no salió del cajón" : ""}</div>
        </div>
        <span class="mov-importe ${sale ? "sale" : "entra"}">${sale ? "−" : "+"}${centsToMoney(Math.abs(importe))}</span>
        ${m.anulado || soloLectura ? "" : `<button type="button" class="ghost-button compact" data-anular="${esc(m.uuid)}">Anular</button>`}
      </div>`;
  }).join("");

  // El total es lo que de verdad se movió del cajón: un gasto con tarjeta es
  // gasto del negocio pero no sale de ahí, y mezclarlos descuadra el arqueo.
  const neto = Number(totales?.netoCajonCentavos) || 0;
  container.innerHTML = `${filas}
    <div class="caja-mov-total">
      <span>Del cajón ${neto < 0 ? "salieron" : "entraron"}</span>
      <span class="${neto < 0 ? "mov-importe sale" : "mov-importe entra"}">${centsToMoney(Math.abs(neto))}</span>
    </div>`;
}
