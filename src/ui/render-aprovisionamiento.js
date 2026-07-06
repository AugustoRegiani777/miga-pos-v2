function timeAgo(isoString) {
  if (!isoString) return "Nunca calibrado";
  const days = Math.floor((Date.now() - new Date(isoString).getTime()) / 86400000);
  if (days === 0) return "Calibrado hoy";
  if (days === 1) return "Calibrado ayer";
  return `Hace ${days} días`;
}

function fmtFecha(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  const dia = ["dom","lun","mar","mié","jue","vie","sáb"][d.getDay()];
  return `${dia} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function fmtPaquetes(amount, insumo) {
  const fc = insumo.factorConversion;
  let paquetes = Math.floor(amount / fc);
  let resto = Math.round(amount % fc);
  if (resto >= fc) { paquetes++; resto = 0; }
  if (resto === 0) return `${paquetes} paquetes`;
  return `${paquetes}.${resto} paquetes`;
}

function displayAmount(amount, insumo) {
  if (insumo.unidad === "g") {
    return amount >= 1000 ? `${(amount / 1000).toFixed(2)} kg` : `${Math.round(amount)} g`;
  }
  if (insumo.unidadCompra === "paquete" && amount >= insumo.factorConversion) {
    return fmtPaquetes(amount, insumo);
  }
  const val = Number.isInteger(amount) ? amount : amount.toFixed(1);
  return `${val} ${insumo.unidad}`;
}

function fmtGramos(g, unidad, insumo = null) {
  if (unidad === "g") {
    if (g >= 1000) return `${parseFloat((g/1000).toFixed(3))} kg`;
    return `${parseFloat(g.toFixed(1))} g`;
  }
  if (insumo && insumo.unidadCompra === "paquete" && g >= insumo.factorConversion) {
    return fmtPaquetes(g, insumo);
  }
  return `${parseFloat(g.toFixed(2))} ${unidad}`;
}

function fmtGramosCalib(g, unidad) {
  return fmtGramos(g, unidad);
}

function diffPct(factor) {
  const pct = Math.round((factor - 1) * 100);
  if (pct > 0) return `<span class="diff-mas">+${pct}%</span>`;
  if (pct < 0) return `<span class="diff-menos">${pct}%</span>`;
  return `<span class="diff-ok">≈ 0%</span>`;
}

function statusPill(estadoStock) {
  if (estadoStock === "critico") return `<span class="stock-pill out">Crítico</span>`;
  if (estadoStock === "bajo") return `<span class="stock-pill low">Bajo</span>`;
  return `<span class="stock-pill ok">OK</span>`;
}

function stockBaseText(insumo) {
  const raw = Math.round(insumo.stockActual * 10) / 10;
  const rawStr = Number.isInteger(raw) ? raw : raw.toFixed(1);
  if (insumo.unidadCompra === "paquete") {
    return `${rawStr} ${insumo.unidad} / ${fmtPaquetes(insumo.stockActual, insumo)}`;
  }
  const enCompra = (insumo.stockActual / insumo.factorConversion).toFixed(2);
  return `${rawStr} ${insumo.unidad} / ${enCompra} ${insumo.unidadCompra}`;
}

export function renderInsumosList(container, insumos, onSelect) {
  if (insumos.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay insumos cargados.</p>';
    return;
  }
  container.innerHTML = insumos.map(insumo => `
    <div class="stock-row" data-id="${insumo.id}" role="button" tabindex="0">
      <div>
        <h2>${insumo.nombre}${insumo.esEstimado ? " ~" : ""}</h2>
        <p>${stockBaseText(insumo)}</p>
      </div>
      <div class="stock-row-actions">${statusPill(insumo.estadoStock)}</div>
    </div>
  `).join("");
  container.querySelectorAll(".stock-row[data-id]").forEach(row => {
    const insumo = insumos.find(i => i.id === row.dataset.id);
    if (!insumo) return;
    const handler = () => onSelect(insumo);
    row.addEventListener("click", handler);
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handler(); } });
  });
}

export function renderInsumoAjusteSelected(container, insumo) {
  if (!insumo) {
    container.innerHTML = "<strong>Selecciona un insumo</strong><small>Stock actual: —</small>";
    return;
  }
  container.innerHTML = `<strong>${insumo.nombre}</strong><small>Stock: ${stockBaseText(insumo)}</small>`;
}

export function renderCalibracionAlert(container, insumos) {
  const pendientes = insumos.filter(i => i.necesitaCalibracion);
  if (pendientes.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <div class="calibracion-banner">
      <strong>Verificar stock real</strong>
      <p>${pendientes.map(i => i.nombre).join(", ")} bajo el minimo. Tap para calibrar.</p>
    </div>
  `;
}

export function renderCalibracionDashboard(container, data, onCalibracion, onSettingsChange) {
  if (data.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay insumos.</p>';
    return;
  }
  container.innerHTML = data.map(insumo => {
    const alerta = insumo.necesitaCalibracion;

    // Período actual desde última calibración
    let periodoHtml = "";
    if (insumo.ultimaCalibracionFecha) {
      if (insumo.totalSandwichesDesdeCalibracion > 0) {
        const recetaActual = insumo.historial.length > 0
          ? fmtGramos(insumo.historial[insumo.historial.length - 1].estimadoDespues, insumo.unidad)
          : null;
        const recetaTag = recetaActual ? ` <span class="cal-muted">× ${recetaActual}</span>` : "";
        periodoHtml = `<p class="cal-periodo">
          Desde ${fmtFecha(insumo.ultimaCalibracionFecha)}:
          <strong>${insumo.totalSandwichesDesdeCalibracion}</strong> unidades${recetaTag}
          &mdash; consumo estimado: <strong>${displayAmount(insumo.consumoEsperado, insumo)}</strong>
        </p>`;
      } else {
        periodoHtml = `<p class="cal-periodo cal-muted">Sin producción desde la última calibración.</p>`;
      }
    }

    // Narrativa de la última calibración + tabla historial
    let historialHtml = "";
    if (insumo.historial.length === 0) {
      historialHtml = `<p class="cal-inicio">La primera calibración activa el aprendizaje del modelo.</p>`;
    } else {
      const ult = insumo.historial[insumo.historial.length - 1];
      const pctVal = Math.round((ult.factorObservado - 1) * 100);
      const pctAbs = Math.abs(pctVal);

      let narrativa;
      if (pctAbs <= 3) {
        narrativa = `Consumo casi exacto al estimado. Modelo bien calibrado.`;
      } else {
        const pctSigno = pctVal > 0 ? "más" : "menos";
        narrativa = `Se usó <strong>${pctAbs}% ${pctSigno}</strong> de lo previsto en ${ult.sandwiches} unidades.
          Receta actualizada: ${fmtGramos(ult.estimadoAntes, insumo.unidad)}
          &rarr; <strong>${fmtGramos(ult.estimadoDespues, insumo.unidad)}</strong> por unidad.`;
      }

      const filas = insumo.historial.map(h => {
        const consEsp  = h.consumoEsperado != null ? fmtGramos(h.consumoEsperado, insumo.unidad, insumo) : "—";
        const consReal = h.recetaFija ? consEsp : (h.consumoReal != null ? fmtGramos(h.consumoReal, insumo.unidad, insumo) : "—");
        const recetaCol = h.recetaFija
          ? `<span class="cal-muted">receta fija · pérdida registrada</span>`
          : h.ajusteAplicado === false
          ? `<span class="cal-muted">consumo exacto</span>`
          : `${fmtGramosCalib(h.estimadoAntes, insumo.unidad)} &rarr; ${fmtGramosCalib(h.estimadoDespues, insumo.unidad)}`;
        return `<tr>
          <td class="cal-hist-fecha">${fmtFecha(h.creadoEn)}</td>
          <td><span class="cal-muted">${h.sandwiches} u &times; ${fmtGramosCalib(h.estimadoAntes, insumo.unidad)}</span></td>
          <td>esperado <strong>${consEsp}</strong> · real <strong>${consReal}</strong></td>
          <td>${h.recetaFija ? '<span class="diff-ok">≈ 0%</span>' : diffPct(h.factorObservado)}</td>
          <td class="cal-muted">${recetaCol}</td>
        </tr>`;
      }).join("");

      historialHtml = `
        <div class="cal-narrativa">${narrativa}</div>
        <div class="cal-hist-wrap">
          <table class="cal-hist-table"><tbody>${filas}</tbody></table>
        </div>`;
    }

    const apbtn = (label, val) =>
      `<button type="button" class="cal-alpha-btn${Math.abs((insumo.alphaPrediccion ?? 0.50) - val) < 0.01 ? " active" : ""}"
        data-insumo="${insumo.id}" data-type="prediccion" data-val="${val}">${label}</button>`;

    const prediccionHtml = `
      <div class="cal-pred-row">
        <span class="cal-setting-label">Predicción</span>
        <div class="cal-setting-btns">
          ${apbtn("Estable",  0.20)}
          ${apbtn("Mixta",    0.50)}
          ${apbtn("Reciente", 0.80)}
        </div>
      </div>`;

    return `
      <div class="cal-card${alerta ? " cal-card--alerta" : ""}">
        <div class="cal-card-header">
          <div class="cal-card-title">
            <strong>${insumo.nombre}</strong>
            ${statusPill(insumo.estadoStock)}
          </div>
        </div>
        ${prediccionHtml}
        <p class="cal-stock-line">
          Stock: <strong>${displayAmount(insumo.stockActual, insumo)}</strong>
          ${insumo.diasRestantes != null ? `&middot; <strong class="dias-restantes">~${insumo.diasRestantes} días</strong>${insumo.sandwichesEstimados != null ? ` <span class="cal-muted">(~${insumo.sandwichesEstimados} sw)</span>` : ""}` : ""}
          <span class="cal-muted">&middot; ${timeAgo(insumo.ultimaCalibracionFecha)}</span>
        </p>
        ${periodoHtml}
        ${historialHtml}
        <button class="${alerta ? "primary-button" : "ghost-button"} cal-calibrar-btn" type="button" data-calibrar="${insumo.id}">
          ${alerta ? "Calibrar ahora" : "Calibrar"}
        </button>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-calibrar]").forEach(btn => {
    const insumo = data.find(i => i.id === btn.dataset.calibrar);
    if (insumo) btn.addEventListener("click", () => onCalibracion(insumo));
  });

  if (onSettingsChange) {
    container.querySelectorAll(".cal-alpha-btn[data-insumo][data-type='prediccion']").forEach(btn => {
      btn.addEventListener("click", () => {
        const insumoId = btn.dataset.insumo;
        const val      = parseFloat(btn.dataset.val);
        const insumo   = data.find(i => i.id === insumoId);
        if (!insumo) return;
        onSettingsChange(insumoId, {
          alphaReceta:     insumo.alphaReceta     ?? 0.80,
          alphaPrediccion: val
        });
      });
    });
  }
}

export function renderCalibracionRecetaSettings(container, insumo, onSettingsChange) {
  const current = insumo.alphaReceta ?? 0.80;
  const btn = (label, val) =>
    `<button type="button" class="cal-alpha-btn${Math.abs(current - val) < 0.01 ? " active" : ""}" data-val="${val}">${label}</button>`;
  container.innerHTML = `
    <div class="cal-pred-row" style="margin-bottom:0.25rem">
      <span class="cal-setting-label">Corrección</span>
      <div class="cal-setting-btns">
        ${btn("Suave 30%",    0.30)}
        ${btn("Normal 60%",   0.60)}
        ${btn("Reactiva 90%", 0.90)}
      </div>
    </div>`;
  container.querySelectorAll(".cal-alpha-btn").forEach(b => {
    b.addEventListener("click", () => {
      const val = parseFloat(b.dataset.val);
      container.querySelectorAll(".cal-alpha-btn").forEach(x => x.classList.toggle("active", x === b));
      onSettingsChange(insumo.id, {
        alphaReceta:     val,
        alphaPrediccion: insumo.alphaPrediccion ?? 0.50
      });
    });
  });
}

function fmtCant(n) {
  return Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(2)).toString();
}

export function renderRecetasEditor(container, data, onEdit) {
  if (data.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay recetas cargadas.</p>';
    return;
  }
  container.innerHTML = data.map(({ productoNombre, recetas }) => {
    const filas = recetas.map(r => {
      const estimadoBadge = r.esEstimado ? `<span class="receta-estimado">~</span>` : "";
      const fijaBadge = r.recetaFija ? `<span class="receta-fija-badge">fija</span>` : "";
      const histFilas = r.historial.length === 0 ? "" : r.historial.map(h => {
        const motivo = h.motivo ? `<span class="receta-hist-motivo">"${h.motivo}"</span>` : "";
        return `<tr class="receta-hist-row">
          <td class="receta-hist-fecha">${fmtFecha(h.creadoEn)}</td>
          <td colspan="2" class="receta-hist-cambio">
            ${fmtCant(h.valorAnterior)} &rarr; <strong>${fmtCant(h.valorNuevo)}</strong> ${r.unidad} ${motivo}
          </td>
        </tr>`;
      }).join("");
      return `<tr>
        <td class="receta-td-nombre">${r.insumoNombre}</td>
        <td class="receta-td-cantidad">${fmtCant(r.cantidadPorUnidad)} <span class="receta-unidad">${r.unidad}</span>${estimadoBadge}${fijaBadge}</td>
        <td class="receta-td-accion">
          <button class="ghost-button compact" type="button" data-editar="${r.id}">Editar</button>
        </td>
      </tr>${histFilas}`;
    }).join("");
    return `
      <div class="receta-card">
        <div class="receta-card-nombre">${productoNombre}</div>
        <table class="receta-table"><tbody>${filas}</tbody></table>
      </div>`;
  }).join("");

  container.querySelectorAll("[data-editar]").forEach(btn => {
    const recetaId = btn.dataset.editar;
    const receta = data.flatMap(p => p.recetas).find(r => r.id === recetaId);
    if (receta) btn.addEventListener("click", () => onEdit(receta));
  });
}

export function renderListaComprasSmart(container, { items, byProveedor }) {
  if (items.length === 0) {
    container.innerHTML = '<p class="empty-state">No hay insumos.</p>';
    return;
  }

  function stockStr(item) {
    if (item.unidad === "g") return item.stockActual >= 1000 ? `${(item.stockActual/1000).toFixed(2)} kg` : `${Math.round(item.stockActual)} g`;
    const v = Number.isInteger(item.stockActual) ? item.stockActual : item.stockActual.toFixed(1);
    return `${v} ${item.unidad}`;
  }

  function urgBadge(urgencia) {
    if (urgencia === "urgente") return `<span class="ldc-badge ldc-urgente">Urgente</span>`;
    if (urgencia === "pronto") return `<span class="ldc-badge ldc-pronto">Pronto</span>`;
    return `<span class="ldc-badge ldc-ok">OK</span>`;
  }

  function diasSpan(item) {
    if (item.diasRestantes === null) return `<span class="ldc-dias ldc-dias-nd">sin datos</span>`;
    return `<span class="ldc-dias">${item.diasRestantes} día${item.diasRestantes !== 1 ? "s" : ""}</span>`;
  }

  function rowHtml(item, showSupplier = true) {
    let supplierHtml = "";
    if (showSupplier) {
      if (item.mejorSupplier) {
        const s = item.mejorSupplier;
        const costoStr = s.costoTotalCentavos > 0 ? ` · ~€${(s.costoTotalCentavos/100).toFixed(2)}` : "";
        const cantStr = s.cantidadEnCompra > 0 ? `Pedir <strong>${s.cantidadEnCompra} ${s.unidadCompra}</strong>${costoStr}` : `Sin pedido necesario`;
        supplierHtml = `<span class="ldc-supplier">${s.proveedorNombre} — ${cantStr}</span>`;
      } else {
        supplierHtml = `<span class="ldc-supplier ldc-sin-prov">Sin proveedor asignado</span>`;
      }
    } else if (item.mejorSupplier) {
      const s = item.mejorSupplier;
      const costoStr = s.costoTotalCentavos > 0 ? ` · ~€${(s.costoTotalCentavos/100).toFixed(2)}` : "";
      supplierHtml = s.cantidadEnCompra > 0
        ? `<span class="ldc-supplier">Pedir <strong>${s.cantidadEnCompra} ${s.unidadCompra}</strong>${costoStr}</span>`
        : `<span class="ldc-supplier ldc-sin-prov">Sin pedido necesario</span>`;
    }
    return `<div class="ldc-row ldc-row--${item.urgencia}">
      <div class="ldc-row-top">${urgBadge(item.urgencia)}<strong class="ldc-nombre">${item.nombre}</strong>${diasSpan(item)}</div>
      <div class="ldc-row-sub"><span class="ldc-stock">Stock: ${stockStr(item)}</span>${supplierHtml}</div>
    </div>`;
  }

  const needsOrder = items.filter(i => i.urgencia !== "ok");

  const urgView = needsOrder.length === 0
    ? `<p class="empty-state">Todo el stock está OK.</p>`
    : needsOrder.map(i => rowHtml(i)).join("");

  const provView = byProveedor.length === 0
    ? `<p class="empty-state">No hay productos para pedir.</p>`
    : byProveedor.map(group => {
      const totalCentavos = group.items.reduce((sum, i) => sum + (i.mejorSupplier?.costoTotalCentavos ?? 0), 0);
      const costoStr = totalCentavos > 0 ? ` · ~€${(totalCentavos/100).toFixed(2)}` : "";
      const cicloStr = group.diasCiclo ? ` · ciclo ${group.diasCiclo}d` : "";
      return `<div class="ldc-prov-group">
        <div class="ldc-prov-header">
          <strong>${group.proveedorNombre}</strong>
          <span class="ldc-prov-meta">${group.items.length} producto${group.items.length !== 1 ? "s" : ""}${cicloStr}${costoStr}</span>
        </div>
        ${group.items.map(i => rowHtml(i, false)).join("")}
      </div>`;
    }).join("");

  const allView = items.map(i => rowHtml(i)).join("");

  container.innerHTML = `
    <div class="ldc-tabs" role="tablist">
      <button class="ldc-tab active" data-tab="urgencia" role="tab">Urgencia</button>
      <button class="ldc-tab" data-tab="proveedor" role="tab">Proveedor</button>
      <button class="ldc-tab" data-tab="todos" role="tab">Todos</button>
    </div>
    <div class="ldc-panel" data-panel="urgencia">${urgView}</div>
    <div class="ldc-panel ldc-panel--hidden" data-panel="proveedor">${provView}</div>
    <div class="ldc-panel ldc-panel--hidden" data-panel="todos">${allView}</div>
  `;

  container.querySelectorAll(".ldc-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".ldc-tab").forEach(t => t.classList.remove("active"));
      container.querySelectorAll(".ldc-panel").forEach(p => p.classList.add("ldc-panel--hidden"));
      tab.classList.add("active");
      container.querySelector(`.ldc-panel[data-panel="${tab.dataset.tab}"]`).classList.remove("ldc-panel--hidden");
    });
  });
}
