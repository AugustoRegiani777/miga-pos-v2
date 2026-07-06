function fmtEur(centavos) {
  return (centavos / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

function precioBaseLabel(producto) {
  const { insumo, costoPorUnidad } = producto;
  if (!insumo) return "";
  const unidad = insumo.unidad;
  if (unidad === "g")  return `${fmtEur(costoPorUnidad * 1000)}/kg`;
  if (unidad === "ml") return `${fmtEur(costoPorUnidad * 1000)}/L`;
  return `${fmtEur(costoPorUnidad)}/${unidad}`;
}

export function renderProveedoresList(el, data, callbacks = {}) {
  if (!data.length) {
    el.innerHTML = "<p class='empty-state'>No hay proveedores registrados.</p>";
    return;
  }

  el.innerHTML = data.map(proveedor => {
    const contacto = [
      proveedor.tel   ? `Tel: ${proveedor.tel}`  : "",
      proveedor.email ? proveedor.email           : ""
    ].filter(Boolean).join(" · ");

    const cicloTexto = proveedor.diasCiclo === 1 ? "diario"
      : proveedor.diasCiclo <= 3  ? `cada ${proveedor.diasCiclo} días`
      : proveedor.diasCiclo <= 7  ? "semanal"
      : proveedor.diasCiclo <= 14 ? "quincenal"
      : "mensual";

    const filasProducto = proveedor.productos.map(p => `
      <tr class="${p.esMasBarato ? "prov-mejor" : ""}">
        <td>
          ${p.nombreProducto}
          ${p.esMasBarato ? '<span class="prov-badge">mejor precio</span>' : ""}
          ${p.insumo ? `<span class="cal-muted prov-insumo-tag">→ ${p.insumo.nombre}</span>` : ""}
        </td>
        <td class="prov-num">${p.unidadCompra}${p.cantidadPorUnidad && p.insumo ? ` (${p.cantidadPorUnidad} ${p.insumo.unidad})` : p.cantidadPorUnidad > 1 ? ` ×${p.cantidadPorUnidad}` : ""}</td>
        <td class="prov-num">${fmtEur(p.precioUnitarioCentavos)}</td>
        <td class="prov-num cal-muted">${precioBaseLabel(p)}</td>
        <td class="prov-td-accion">
          <button class="ghost-button compact" data-action="edit-prod" data-id="${p.id}" data-provid="${proveedor.id}">Editar</button>
        </td>
      </tr>`).join("");

    const tablaHTML = proveedor.productos.length
      ? `<div class="prov-table-wrap">
          <table class="prov-tabla">
            <thead><tr><th>Producto</th><th>Unidad compra</th><th>Precio</th><th>Precio base</th><th></th></tr></thead>
            <tbody>${filasProducto}</tbody>
          </table>
         </div>`
      : "<p class='cal-muted' style='padding:0.5rem 0'>Sin productos registrados.</p>";

    return `
      <details class="prov-card" data-prov-id="${proveedor.id}">
        <summary class="prov-summary">
          <div class="prov-summary-main">
            <strong>${proveedor.nombre}</strong>
            <span class="cal-muted">${proveedor.productos.length} producto${proveedor.productos.length !== 1 ? "s" : ""} · ${cicloTexto}</span>
          </div>
          <button class="ghost-button compact prov-edit-btn" data-action="edit-prov" data-id="${proveedor.id}">Editar</button>
        </summary>
        <div class="prov-detail">
          ${contacto ? `<p class="prov-contact">${contacto}</p>` : ""}
          ${proveedor.notas ? `<p class="cal-muted prov-notas">${proveedor.notas}</p>` : ""}
          ${tablaHTML}
          <div class="prov-add-row">
            <button class="ghost-button compact" data-action="add-prod" data-provid="${proveedor.id}">+ Agregar producto</button>
          </div>
        </div>
      </details>`;
  }).join("");

  // Event delegation
  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === "edit-prov") {
      e.preventDefault();
      const proveedor = data.find(p => p.id === btn.dataset.id);
      if (proveedor) callbacks.onEditProv?.(proveedor);
    }

    if (action === "add-prod") {
      callbacks.onAddProd?.(btn.dataset.provid);
    }

    if (action === "edit-prod") {
      const proveedor = data.find(p => p.id === btn.dataset.provid);
      const prod = proveedor?.productos.find(p => p.id === btn.dataset.id);
      if (prod) callbacks.onEditProd?.(prod);
    }
  }, { once: false });
}

export function renderProvProdInsumoSelect(selectEl, insumos, selectedId) {
  selectEl.innerHTML =
    `<option value="">— ninguno (para reventa) —</option>` +
    insumos
      .filter(i => i.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(i => `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${i.nombre} (${i.unidad})</option>`)
      .join("");
}
