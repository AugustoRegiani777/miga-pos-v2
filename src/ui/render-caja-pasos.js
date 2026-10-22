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
      : `<p class="caja-comentario">Contá la plata que hay en el cajón antes de empezar. Es el punto de partida de todo lo demás.</p>
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

// ------------------------------------------------------- 2. pagos y retiros (una sola seccion)
// Pagar algo y retirar plata son la misma accion: sacar efectivo del cajon. Una lista, un boton.
// Cada renglon dice si fue un pago (compra) o un retiro, y los pagos con tarjeta se marcan aparte
// porque no salen del cajon.
export function renderPasoSalidas(container, { salidas, pagosCentavos, retirosCentavos }) {
  const lista = salidas.length === 0
    ? `<p class="empty-state">Todavía no anotaste ninguna salida de efectivo.</p>`
    : salidas.map((m) => {
        const esRetiro = m.tipo === "retiro";
        const etiqueta = esRetiro ? "Retiro" : (m.afectaCajon === false ? "Pago con tarjeta" : "Pago");
        return `
        <div class="caja-mov-fila${m.anulado ? " anulado" : ""}">
          <div class="mov-motivo">
            <strong>${esc(m.motivo)}</strong>
            <div class="cal-muted">${hora(m.ocurridoEn)} · ${etiqueta}${m.afectaCajon === false ? " (no sale del cajón)" : ""}</div>
          </div>
          <span class="mov-importe sale">−${centsToMoney(Math.abs(Number(m.importeCentavos) || 0))}</span>
          ${m.anulado ? "" : `<button type="button" class="ghost-button compact" data-anular="${esc(m.uuid)}">Anular</button>`}
        </div>`;
      }).join("");
  const total = pagosCentavos + retirosCentavos;
  container.innerHTML = paso(
    2,
    "Pagos y retiros",
    salidas.length > 0 ? "hecho" : "pendiente",
    `<p class="caja-comentario">Todo lo que sale de la caja en efectivo, cuando pasa: lo que pagás (compras, proveedores) y lo que retirás (al banco, a la caja fuerte).</p>
     ${lista}
     ${total > 0 ? `<div class="caja-mov-total"><span>Salió de la caja hoy <small class="cal-muted">(pagos ${centsToMoney(pagosCentavos)} · retiros ${centsToMoney(retirosCentavos)})</small></span><span class="mov-importe sale">${centsToMoney(total)}</span></div>` : ""}`,
    `<button class="primary-button compact" type="button" id="caja-nueva-salida">+ Anotar salida de efectivo</button>`
  );
}

// ------------------------------------------------------- 3. cuenta rapida de efectivo
// La cuenta de la caja: de donde sale lo que deberia haber, mas los chequeos del dia. En cualquier momento
// se puede contar la plata y dejarlo marcado (a que hora, cuanto habia y quien lo conto): "12 del mediodia,
// cuento y marco que habia tanto". Es trazabilidad; no cierra nada.
export function renderCuentaRapida(container, { foto, controles = [] }) {
  if (!foto) { container.innerHTML = ""; return; }
  const fila = (texto, valor, clase = "") => `<div class="cierre-row ${clase}"><span>${texto}</span><strong>${valor}</strong></div>`;
  const lineaControl = (c) => {
    const dif = Number(c.diferenciaCentavos) || 0;
    const clase = dif === 0 ? "ok" : Math.abs(dif) <= 100 ? "chico" : "grande";
    const texto = dif === 0 ? "cuadra" : `${dif > 0 ? "sobran" : "faltan"} ${centsToMoney(Math.abs(dif))}`;
    return `
      <li class="caja-control">
        <span class="caja-control-hora">${hora(c.contadoEn || c.creadoEn)}</span>
        <span class="caja-control-quien">${esc(c.contadoPor)}</span>
        <span>contó <strong>${centsToMoney(c.contadoCentavos)}</strong> <small class="cal-muted">(el sistema decía ${centsToMoney(c.esperadoCentavos)})</small></span>
        <span class="cierre-diff-mini is-${clase}">${texto}</span>
      </li>`;
  };
  container.innerHTML = `
    <section class="caja-paso caja-paso--cuenta">
      <div class="caja-paso-head">
        <span class="caja-paso-num">3</span>
        <h2>Cuenta rápida de efectivo</h2>
        <button class="ghost-button compact" type="button" id="caja-contar-ahora">Contar la caja ahora</button>
      </div>
      <div class="caja-paso-body">
        <div class="caja-cuenta">
          ${fila("Abriste con", centsToMoney(foto.fondoCentavos))}
          ${fila("Cobrado en efectivo", "+" + centsToMoney(foto.ventasEfectivoCentavos))}
          ${foto.ingresosCentavos ? fila("Otros ingresos al cajón", "+" + centsToMoney(foto.ingresosCentavos)) : ""}
          ${foto.pagosCentavos ? fila("Pagos", "−" + centsToMoney(foto.pagosCentavos)) : ""}
          ${foto.retirosCentavos ? fila("Retiros", "−" + centsToMoney(foto.retirosCentavos)) : ""}
          ${foto.ajustesCentavos ? fila("Ajustes", centsToMoney(foto.ajustesCentavos)) : ""}
          ${fila("Debería haber en la caja", centsToMoney(foto.esperadoCentavos), "cierre-row--total")}
        </div>
        <h3 class="caja-controles-titulo">Chequeos de hoy</h3>
        ${controles.length
          ? `<ul class="caja-controles">${controles.map(lineaControl).join("")}</ul>`
          : `<p class="cal-muted">Todavía no contaste la caja hoy. Podés hacerlo en cualquier momento y queda marcado.</p>`}
      </div>
    </section>`;
}
