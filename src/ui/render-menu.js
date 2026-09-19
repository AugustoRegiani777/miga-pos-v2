function fmtEur(centavos) {
  return (centavos / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export function renderMenuList(el, categorias, callbacks = {}) {
  if (!categorias.length) {
    el.innerHTML = "<p class='empty-state'>No hay categorias cargadas.</p>";
    return;
  }

  el.innerHTML = categorias.map(categoria => {
    const filas = categoria.productos.map((producto, index) => {
      const ocultoBadge = producto.activo ? "" : '<span class="prov-badge prov-badge-muted">oculto</span>';
      const premiumBadge = producto.sandwichTipo === "premium" ? '<span class="prov-badge">de la casa</span>' : "";
      const recetaTag = producto.recetaResumen.length
        ? `<span class="cal-muted prov-insumo-tag">${producto.recetaResumen.join(", ")}</span>`
        : "";
      return `
        <tr>
          <td>
            ${producto.nombre}
            ${premiumBadge}
            ${ocultoBadge}
            ${recetaTag}
          </td>
          <td class="prov-num">${fmtEur(producto.precioCentavos)}</td>
          <td class="prov-td-accion">
            <button class="ghost-button compact" type="button" data-action="mover" data-dir="up" data-id="${producto.id}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button class="ghost-button compact" type="button" data-action="mover" data-dir="down" data-id="${producto.id}" ${index === categoria.productos.length - 1 ? "disabled" : ""}>↓</button>
            <button class="ghost-button compact" type="button" data-action="toggle-activo" data-id="${producto.id}">${producto.activo ? "Ocultar" : "Mostrar"}</button>
            <button class="ghost-button compact" type="button" data-action="edit-producto" data-id="${producto.id}">Editar</button>
          </td>
        </tr>`;
    }).join("");

    const tablaHTML = categoria.productos.length
      ? `<div class="prov-table-wrap">
          <table class="prov-tabla">
            <thead><tr><th>Producto</th><th>Precio</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
         </div>`
      : "<p class='cal-muted' style='padding:0.5rem 0'>Sin productos en esta categoria.</p>";

    return `
      <details class="prov-card" open data-categoria-id="${categoria.id}">
        <summary class="prov-summary">
          <div class="prov-summary-main">
            <strong>${categoria.nombre}</strong>
            <span class="cal-muted">${categoria.productos.length} producto${categoria.productos.length !== 1 ? "s" : ""}</span>
          </div>
        </summary>
        <div class="prov-detail">
          ${tablaHTML}
          <div class="prov-add-row">
            <button class="ghost-button compact" type="button" data-action="add-producto" data-catid="${categoria.id}">+ Agregar producto</button>
          </div>
        </div>
      </details>`;
  }).join("");

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === "add-producto") {
      e.preventDefault();
      callbacks.onAdd?.(btn.dataset.catid);
    }

    if (action === "edit-producto") {
      e.preventDefault();
      const producto = categorias.flatMap(c => c.productos).find(p => p.id === btn.dataset.id);
      if (producto) callbacks.onEdit?.(producto);
    }

    if (action === "toggle-activo") {
      e.preventDefault();
      const producto = categorias.flatMap(c => c.productos).find(p => p.id === btn.dataset.id);
      if (producto) callbacks.onToggleActivo?.(producto);
    }

    if (action === "mover") {
      e.preventDefault();
      callbacks.onMover?.(btn.dataset.id, btn.dataset.dir);
    }
  }, { once: false });
}

export function renderMenuInsumoSelect(selectEl, insumos, selectedId) {
  selectEl.innerHTML =
    `<option value="" ${selectedId ? "" : "selected"}>— Elegi un insumo —</option>` +
    insumos
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(i => `<option value="${i.id}" ${i.id === selectedId ? "selected" : ""}>${i.nombre} (${i.unidad})</option>`)
      .join("") +
    `<option value="__nuevo__" ${selectedId === "__nuevo__" ? "selected" : ""}>+ Crear insumo nuevo…</option>`;
}

// Si el insumo de esta linea es una de las opciones de un grupo de variante
// (ver Gestion > Variantes), por defecto la cantidad es la misma para
// cualquier opcion del grupo (solo cambia de que insumo puntual sale al
// vender, ver resolverLineaEfectiva en aprovisionamiento.js) — pero cada
// opcion, salvo la que ya tiene su propio campo "Cantidad" arriba, puede
// pisar ese valor con uno propio (ej: la avena rinde distinto que la
// entera). Vacio = usa la cantidad base de arriba, sin excepcion.
function lineaVarianteCantidades(linea, grupos, insumos, index) {
  const grupo = grupos.find((g) => (g.opciones || []).some((o) => o.insumoId === linea.insumoId));
  if (!grupo) return "";
  const unidad = insumos.find((i) => i.id === linea.insumoId)?.unidad || "";
  const cantidadBase = linea.cantidad || 0;
  const overrides = linea.variantesCantidad || {};
  const filas = grupo.opciones
    .filter((o) => o.insumoId !== linea.insumoId)
    .map((o) => `
      <div class="menu-receta-variante-opcion-row">
        <span>${o.nombre}</span>
        <input class="menu-receta-variante-cantidad" data-idx="${index}" data-opcion="${o.nombre}" type="number" min="0" step="any" inputmode="decimal" placeholder="${cantidadBase}" value="${overrides[o.nombre] ?? ""}">
        <span class="cal-muted">${unidad}</span>
      </div>`)
    .join("");
  if (!filas) return "";
  return `
    <div class="menu-receta-variante-cantidades">
      <p class="cal-muted" style="margin: 0.35rem 0 0.15rem;">Cantidad para las otras opciones de "${grupo.nombre}" (vacío = igual que arriba, ${cantidadBase}${unidad})</p>
      ${filas}
    </div>`;
}

export function renderMenuRecetaRows(container, lineas, insumos, grupos = []) {
  if (!lineas.length) {
    container.innerHTML = "<p class='cal-muted' style='padding:0.25rem 0'>Sin insumos agregados todavia.</p>";
    return;
  }

  container.innerHTML = lineas.map((linea, index) => {
    const esNuevo = linea.insumoId === "__nuevo__";
    return `
      <div class="menu-receta-row" data-idx="${index}">
        <div class="menu-receta-row-main">
          <select class="menu-receta-insumo" data-idx="${index}"></select>
          <input class="menu-receta-cantidad" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Cantidad" value="${linea.cantidad ?? ""}">
          <button class="ghost-button compact" type="button" data-action="quitar-linea" data-idx="${index}" aria-label="Quitar">×</button>
        </div>
        ${esNuevo ? `
          <div class="menu-receta-nuevo-fields">
            <input class="menu-receta-nuevo-nombre" data-idx="${index}" type="text" placeholder="Nombre del insumo nuevo" value="${linea.nuevoNombre ?? ""}">
            <input class="menu-receta-nuevo-unidad" data-idx="${index}" type="text" placeholder="Unidad (g, ml, unidad...)" value="${linea.nuevaUnidad ?? ""}">
          </div>
          <div class="menu-receta-nuevo-fields">
            <input class="menu-receta-nuevo-min" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Stock minimo" value="${linea.nuevoStockMinimo ?? ""}">
            <input class="menu-receta-nuevo-critico" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Stock critico" value="${linea.nuevoStockCritico ?? ""}">
          </div>` : ""}
        ${lineaVarianteCantidades(linea, grupos, insumos, index)}
      </div>`;
  }).join("");

  container.querySelectorAll(".menu-receta-insumo").forEach((select) => {
    const linea = lineas[Number(select.dataset.idx)];
    renderMenuInsumoSelect(select, insumos, linea.insumoId);
  });
}
