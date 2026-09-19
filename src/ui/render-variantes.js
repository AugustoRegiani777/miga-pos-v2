import { renderMenuInsumoSelect } from "./render-menu.js";

export function renderVariantesGruposList(el, grupos, callbacks = {}) {
  if (!grupos.length) {
    el.innerHTML = "<p class='empty-state'>No hay grupos de variante todavia.</p>";
    return;
  }

  el.innerHTML = grupos.map((grupo) => {
    const opcionesTexto = grupo.opciones.map((o) => o.nombre).join(", ") || "sin opciones";
    const productosTexto = grupo.productoIds.length
      ? `${grupo.productoIds.length} producto${grupo.productoIds.length !== 1 ? "s" : ""}`
      : "sin productos asignados";
    return `
      <details class="prov-card" data-grupo-id="${grupo.id}">
        <summary class="prov-summary">
          <div class="prov-summary-main">
            <strong>${grupo.nombre}</strong>
            <span class="cal-muted">${grupo.titulo} · ${productosTexto}</span>
          </div>
          <button class="ghost-button compact prov-edit-btn" type="button" data-action="edit-grupo" data-id="${grupo.id}">Editar</button>
        </summary>
        <div class="prov-detail">
          <p class="prov-contact">Opciones: ${opcionesTexto}</p>
          <div class="prov-add-row">
            <button class="ghost-button compact" type="button" data-action="delete-grupo" data-id="${grupo.id}">Eliminar grupo</button>
          </div>
        </div>
      </details>`;
  }).join("");

  el.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    const grupo = grupos.find((g) => g.id === btn.dataset.id);
    if (!grupo) return;
    if (btn.dataset.action === "edit-grupo") {
      e.preventDefault();
      callbacks.onEdit?.(grupo);
    }
    if (btn.dataset.action === "delete-grupo") {
      callbacks.onDelete?.(grupo);
    }
  });
}

// Filas "nombre de la opcion + insumo que descuenta" — mismo patron visual
// que las filas de receta de Menu, reusa renderMenuInsumoSelect (incluida la
// opcion "+ Crear insumo nuevo...") para no duplicarla una tercera vez.
export function renderVariantesOpcionesRows(container, opciones, insumos) {
  if (!opciones.length) {
    container.innerHTML = "<p class='cal-muted' style='padding:0.25rem 0'>Sin opciones cargadas todavia.</p>";
    return;
  }

  container.innerHTML = opciones.map((opcion, index) => {
    const esNuevo = opcion.insumoId === "__nuevo__";
    return `
      <div class="menu-receta-row" data-idx="${index}">
        <div class="menu-receta-row-main">
          <input class="variante-opcion-nombre" data-idx="${index}" type="text" placeholder="Nombre (ej: Soja)" value="${opcion.nombre ?? ""}">
          <select class="variante-opcion-insumo" data-idx="${index}"></select>
          <button class="ghost-button compact" type="button" data-action="quitar-variante" data-idx="${index}" aria-label="Quitar">×</button>
        </div>
        ${esNuevo ? `
          <div class="menu-receta-nuevo-fields">
            <input class="variante-nuevo-nombre" data-idx="${index}" type="text" placeholder="Nombre del insumo nuevo" value="${opcion.nuevoInsumo?.nombre ?? ""}">
            <input class="variante-nuevo-unidad" data-idx="${index}" type="text" placeholder="Unidad (g, ml...)" value="${opcion.nuevoInsumo?.unidad ?? ""}">
          </div>
          <div class="menu-receta-nuevo-fields">
            <input class="variante-nuevo-min" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Stock minimo" value="${opcion.nuevoInsumo?.stockMinimo ?? ""}">
            <input class="variante-nuevo-crit" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Stock critico" value="${opcion.nuevoInsumo?.stockCritico ?? ""}">
          </div>` : ""}
      </div>`;
  }).join("");

  container.querySelectorAll(".variante-opcion-insumo").forEach((select) => {
    const opcion = opciones[Number(select.dataset.idx)];
    renderMenuInsumoSelect(select, insumos, opcion.insumoId);
  });
}

export function renderVariantesProductosChecklist(container, productoIds, productosDisponibles) {
  const seleccionados = new Set(productoIds);
  container.innerHTML = productosDisponibles.map((p) => `
    <label class="pedido-check-field">
      <input type="checkbox" class="variante-producto-check" value="${p.id}" ${seleccionados.has(p.id) ? "checked" : ""}>
      <span>${p.nombre}</span>
    </label>
  `).join("");
}
