import { centsToMoney } from "../utils/format.js";
import { resumenDelDia, tendencia, variacionPct, alertasInsumos, sumarDias } from "../modules/panel-calculos.js";

const DIAS_SEMANA = ["D", "L", "M", "X", "J", "V", "S"];
const HORA_DESDE = 10;
const HORA_HASTA = 22;

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function diaSemana(fechaISO) {
  return DIAS_SEMANA[new Date(`${fechaISO}T00:00:00Z`).getUTCDay()];
}

function tarjetaKpi(titulo, valor, detalle = "", clase = "") {
  return `
    <article class="panel-kpi ${clase}">
      <span class="panel-kpi-title">${esc(titulo)}</span>
      <strong class="panel-kpi-value">${esc(valor)}</strong>
      <small class="panel-kpi-detail">${detalle}</small>
    </article>`;
}

function textoVariacion(pct) {
  if (pct === null) return "sin dato de la semana pasada";
  if (pct === 0) return "igual que la semana pasada";
  return `<span class="${pct > 0 ? "panel-up" : "panel-down"}">${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}%</span> vs semana pasada`;
}

function graficoHoras(resumen) {
  const conVentas = resumen.porHora.map((b, h) => (b.tickets > 0 ? h : null)).filter((h) => h !== null);
  const desde = Math.min(HORA_DESDE, ...conVentas);
  const hasta = Math.max(HORA_HASTA - 1, ...conVentas);
  const maximo = Math.max(1, ...resumen.porHora.map((b) => b.tickets));
  const barras = [];
  for (let h = desde; h <= hasta; h++) {
    const b = resumen.porHora[h];
    const esPico = resumen.pico && resumen.pico.hora === h;
    barras.push(`
      <div class="panel-bar-col" title="${h}:00 a ${h}:59 — ${b.tickets} tickets, ${centsToMoney(b.centavos)}">
        <span class="panel-bar-num">${b.tickets || ""}</span>
        <div class="panel-bar-track"><div class="panel-bar ${esPico ? "is-peak" : ""}" style="height:${Math.round((b.tickets / maximo) * 100)}%"></div></div>
        <span class="panel-bar-label">${h}</span>
      </div>`);
  }
  return `<div class="panel-bars panel-bars-hours">${barras.join("")}</div>`;
}

function graficoTendencia(datos, fechaElegida) {
  const t = tendencia(datos.ventas, fechaElegida);
  const maximo = Math.max(1, ...t.serie.map((d) => d.centavos));
  const barras = t.serie.map((d) => `
      <div class="panel-bar-col" title="${d.fecha} — ${d.tickets} tickets, ${centsToMoney(d.centavos)}">
        <div class="panel-bar-track"><div class="panel-bar ${d.fecha === fechaElegida ? "is-selected" : ""}" style="height:${Math.round((d.centavos / maximo) * 100)}%"></div></div>
        <span class="panel-bar-label">${Number(d.fecha.slice(8))}</span>
        <span class="panel-bar-sub">${diaSemana(d.fecha)}</span>
      </div>`).join("");
  const mejor = t.mejor ? `Mejor día: ${Number(t.mejor.fecha.slice(8))}/${Number(t.mejor.fecha.slice(5, 7))} (${centsToMoney(t.mejor.centavos)})` : "";
  return `
    <div class="panel-bars panel-bars-days">${barras}</div>
    <p class="panel-note">Promedio por día con ventas: <strong>${centsToMoney(t.promedioCentavos)}</strong>${mejor ? ` · ${mejor}` : ""}</p>`;
}

function listaTop(resumen) {
  if (resumen.top.length === 0) return `<p class="panel-empty">Sin productos vendidos.</p>`;
  const maximo = resumen.top[0].cantidad || 1;
  return `<ol class="panel-top">${resumen.top.slice(0, 7).map((p) => `
      <li>
        <span class="panel-top-name">${esc(p.nombre)}</span>
        <span class="panel-top-bar"><i style="width:${Math.round((p.cantidad / maximo) * 100)}%"></i></span>
        <strong>${p.cantidad}</strong>
        <small>${centsToMoney(p.centavos)}</small>
      </li>`).join("")}</ol>`;
}

function bloqueStock(datos) {
  const conStock = datos.productos.filter((p) => p.controlaStock).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const filasProductos = conStock.map((p) => `
      <li><span>${esc(p.nombre)}</span><strong class="${p.stockActual <= 0 ? "panel-down" : ""}">${p.stockActual}</strong></li>`).join("");
  const alertas = alertasInsumos(datos.insumos);
  const filasInsumos = alertas.length === 0
    ? `<li class="panel-ok">✓ Insumos en orden</li>`
    : alertas.map((a) => `
      <li class="panel-insumo-${a.estado}">
        <span>${esc(a.nombre)}</span>
        <strong>${Math.round(a.stock * 100) / 100} ${esc(a.unidad)}</strong>
        <small>${a.estado === "negativo" ? "falta cargar una factura" : a.estado === "critico" ? "crítico" : "bajo"}</small>
      </li>`).join("");
  return `
    <div class="panel-two-cols">
      <div><h3>Productos ahora</h3><ul class="panel-list">${filasProductos || `<li class="panel-empty">Sin productos con stock.</li>`}</ul></div>
      <div><h3>Insumos que piden atención</h3><ul class="panel-list">${filasInsumos}</ul></div>
    </div>`;
}

export function renderPanel(container, datos) {
  const ventasDia = datos.ventas.filter((v) => v.fecha === datos.fecha);
  const r = resumenDelDia(ventasDia, datos.productosPorId);
  const semanaPasada = resumenDelDia(datos.ventas.filter((v) => v.fecha === sumarDias(datos.fecha, -7)), datos.productosPorId);
  const variacion = variacionPct(r.facturacionCentavos, semanaPasada.facturacionCentavos);

  const combosTexto = r.combos.docenas + r.combos.medias === 0
    ? "sin pedidos por docena"
    : [r.combos.docenas ? `${r.combos.docenas} docena${r.combos.docenas > 1 ? "s" : ""}` : "", r.combos.medias ? `${r.combos.medias} media${r.combos.medias > 1 ? "s" : ""} docena` : ""].filter(Boolean).join(" + ");

  const aviso = datos.fuente === "local"
    ? `<p class="panel-aviso">Sin conexión: se muestra lo guardado en este dispositivo (no incluye ventas de otros dispositivos).</p>`
    : "";

  container.innerHTML = `
    ${aviso}
    <section class="panel-kpis" aria-label="Resumen del día">
      ${tarjetaKpi("Facturación", centsToMoney(r.facturacionCentavos), textoVariacion(variacion), "is-main")}
      ${tarjetaKpi("Tickets", String(r.tickets), r.tickets ? `ticket medio ${centsToMoney(r.ticketMedioCentavos)}` : "")}
      ${tarjetaKpi("Sándwiches", String(r.sandwiches), combosTexto)}
      ${tarjetaKpi("Pico de caja", r.pico ? `${r.pico.hora}–${r.pico.hora + 1} h` : "—", r.pico ? `${r.pico.tickets} tickets en esa hora` : "sin ventas")}
      ${tarjetaKpi("Too Good To Go", String(r.paquetes), r.paquetes ? `paquetes · ${r.unidadesEnPaquetes} unidades adentro` : "sin paquetes")}
    </section>

    <section class="panel-card">
      <h2>Tickets por hora</h2>
      ${r.tickets ? graficoHoras(r) : `<p class="panel-empty">No hay ventas registradas para esta fecha.</p>`}
    </section>

    <div class="panel-grid">
      <section class="panel-card">
        <h2>Lo más vendido</h2>
        ${listaTop(r)}
        ${r.combos.descuentoCentavos ? `<p class="panel-note">Descuentos por combo: <strong>${centsToMoney(r.combos.descuentoCentavos)}</strong></p>` : ""}
      </section>
      <section class="panel-card">
        <h2>Últimos 14 días</h2>
        ${graficoTendencia(datos, datos.fecha)}
      </section>
    </div>

    <section class="panel-card">
      <h2>Stock ahora</h2>
      ${bloqueStock(datos)}
    </section>`;
}
