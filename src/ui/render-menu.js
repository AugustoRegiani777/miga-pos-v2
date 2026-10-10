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
      // "En prueba": se vende y se produce normal, pero todavia no se definio de
      // donde sale (ni receta, ni se compra hecho). Un producto oculto no la lleva.
      const pruebaBadge = producto.activo && producto.tieneReceta === false
        ? '<span class="prov-badge prov-badge-prueba" title="Todavía no tiene receta: no descuenta ningún insumo">en prueba</span>'
        : "";
      const recetaTag = producto.recetaResumen.length
        ? `<span class="cal-muted prov-insumo-tag">${producto.recetaResumen.join(", ")}</span>`
        : "";
      return `
        <tr draggable="false" data-fila-id="${producto.id}" data-categoria="${categoria.id}">
          <td class="celda-asa">
            <button class="asa-orden" type="button" data-action="asa" data-id="${producto.id}"
                    aria-label="Mover ${producto.nombre}" title="Mantené y arrastrá para cambiar el orden">⋮⋮</button>
          </td>
          <td>
            ${producto.nombre}
            ${premiumBadge}
            ${ocultoBadge}
            ${pruebaBadge}
            ${recetaTag}
          </td>
          <td class="prov-num">${fmtEur(producto.precioCentavos)}</td>
          <td class="prov-td-accion">
            <button class="ghost-button compact" type="button" data-action="toggle-activo" data-id="${producto.id}">${producto.activo ? "Ocultar" : "Mostrar"}</button>
            <button class="ghost-button compact" type="button" data-action="edit-producto" data-id="${producto.id}">Editar</button>
          </td>
        </tr>`;
    }).join("");

    const tablaHTML = categoria.productos.length
      ? `<div class="prov-table-wrap">
          <table class="prov-tabla">
            <thead><tr><th class="celda-asa"></th><th>Producto</th><th>Precio</th><th></th></tr></thead>
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

// Lo que falta cuando se crea un insumo desde aca.
//
// El dueño creo "lengua carne" para un sandwich nuevo y el insumo quedo a
// medias: sin minimo (los campos estaban vacios -> 0) y sin proveedor, porque
// habia que ir a OTRA pantalla a asignarselo. Sus palabras: "podria haberme
// ofrecido antes que le asigne proveedor". Tenia razon: el dato se pide donde
// se crea la cosa, no en otro lado y mas tarde.
//
// El minimo se PROPONE calculado, no se pide en frio: nadie sabe de memoria
// cuantos gramos de lengua quiere tener siempre, pero todos saben que hacen
// mas o menos 50 sandwiches de ese tipo antes de reponer. cantidad x 50, y el
// critico a la mitad. Se muestran en el campo para que se vean y se puedan
// cambiar — no es un default escondido.
const SANDWICHES_ANTES_DE_REPONER = 50;
function minimoSugerido(cantidad) {
  const n = parseFloat(String(cantidad ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const crudo = n * SANDWICHES_ANTES_DE_REPONER;
  // Redondeo a algo que se lea bien: 1500, no 1487,5.
  const paso = crudo >= 1000 ? 100 : crudo >= 100 ? 10 : 1;
  return Math.max(paso, Math.round(crudo / paso) * paso);
}

function bloqueProveedorNuevo(linea, index, proveedores) {
  const elegido = linea.nuevoProveedorId || "";
  const opciones = proveedores
    .map((v) => `<option value="${v.id}" ${v.id === elegido ? "selected" : ""}>${v.nombre}</option>`)
    .join("");
  return `
    <div class="menu-receta-nuevo-prov">
      <label class="menu-receta-nuevo-prov-quien">
        <span>¿A quién se lo comprás?</span>
        <select class="menu-receta-nuevo-proveedor" data-idx="${index}">
          <option value="" ${elegido ? "" : "selected"}>— Lo cargo después —</option>
          ${opciones}
        </select>
      </label>
      ${elegido ? `
        <div class="menu-receta-nuevo-fields">
          <input class="menu-receta-nuevo-prov-nombre" data-idx="${index}" type="text" placeholder="Cómo figura en su factura" value="${linea.nuevoProveedorProducto ?? ""}">
          <input class="menu-receta-nuevo-prov-unidad" data-idx="${index}" type="text" placeholder="Cómo te lo factura (kg, caja...)" value="${linea.nuevoProveedorUnidad ?? ""}">
        </div>
        <div class="menu-receta-nuevo-fields">
          <input class="menu-receta-nuevo-prov-trae" data-idx="${index}" type="text" inputmode="decimal" placeholder="Cuánto trae (en ${linea.nuevaUnidad || "la unidad del insumo"})" value="${linea.nuevoProveedorTrae ?? ""}">
          <input class="menu-receta-nuevo-prov-precio" data-idx="${index}" type="text" inputmode="decimal" placeholder="Precio de esa unidad (€)" value="${linea.nuevoProveedorPrecio ?? ""}">
        </div>` : ""}
    </div>`;
}

export function renderMenuRecetaRows(container, lineas, insumos, grupos = [], proveedores = []) {
  if (!lineas.length) {
    container.innerHTML = "<p class='cal-muted' style='padding:0.25rem 0'>Sin insumos agregados todavia.</p>";
    return;
  }

  container.innerHTML = lineas.map((linea, index) => {
    const esNuevo = linea.insumoId === "__nuevo__";
    const sugerido = esNuevo ? minimoSugerido(linea.cantidad) : null;
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
            <input class="menu-receta-nuevo-min" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Mínimo${sugerido ? `: ${sugerido}` : ""}" value="${linea.nuevoStockMinimo ?? (sugerido ?? "")}">
            <input class="menu-receta-nuevo-critico" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Crítico${sugerido ? `: ${Math.round(sugerido / 2)}` : ""}" value="${linea.nuevoStockCritico ?? (sugerido ? Math.round(sugerido / 2) : "")}">
          </div>
          <p class="menu-receta-nuevo-ayuda cal-muted">${sugerido
            ? `Calculado para ${SANDWICHES_ANTES_DE_REPONER} unidades antes de reponer. Cambialo si querés.`
            : "Poné primero la cantidad y te propongo un mínimo."}</p>
          ${bloqueProveedorNuevo(linea, index, proveedores)}` : ""}
        ${lineaVarianteCantidades(linea, grupos, insumos, index)}
      </div>`;
  }).join("");

  container.querySelectorAll(".menu-receta-insumo").forEach((select) => {
    const linea = lineas[Number(select.dataset.idx)];
    renderMenuInsumoSelect(select, insumos, linea.insumoId);
  });
}

// Crear la variante sin salir del alta del producto.
//
// Antes el desplegable solo ofrecia los grupos que ya existian: si estabas
// creando un cafe con leche y el grupo "Tipo de leche" no existia, habia que
// cancelar, irse a Gestion > Variantes, crearlo, y volver a empezar el
// producto. El dueño: "crear la variante antes es un paso previo que enrosca".
//
// Una variante es una pregunta con respuestas, y cada respuesta dice QUE
// insumo se descuenta en lugar del de la receta. Eso es todo lo que se pide
// aca: el nombre de la pregunta y las respuestas. Lo fino (que productos mas
// la usan, cantidades distintas por opcion) sigue estando en su pantalla.
export function renderMenuVarianteNueva(container, estado, insumos) {
  if (!estado) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  const opcionesInsumo = (seleccionado) =>
    `<option value="">— Qué insumo descuenta —</option>` +
    insumos
      .slice()
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map((i) => `<option value="${i.id}" ${i.id === seleccionado ? "selected" : ""}>${i.nombre} (${i.unidad})</option>`)
      .join("");

  container.innerHTML = `
    <div class="menu-variante-nueva">
      <label class="quantity-field">
        <span>¿Qué se pregunta? <small>(se lee tal cual en la caja)</small></span>
        <input class="menu-variante-nueva-nombre" type="text" placeholder="Tipo de leche" value="${estado.nombre ?? ""}">
      </label>
      <p class="cal-muted" style="margin:.4rem 0 .2rem;">Respuestas posibles. La primera es la que lleva la receta por defecto.</p>
      ${estado.opciones.map((o, i) => `
        <div class="menu-variante-opcion" data-idx="${i}">
          <input class="menu-variante-opcion-nombre" data-idx="${i}" type="text" placeholder="${i === 0 ? "Entera" : "Avena"}" value="${o.nombre ?? ""}">
          <select class="menu-variante-opcion-insumo" data-idx="${i}">${opcionesInsumo(o.insumoId)}</select>
          <button class="ghost-button compact" type="button" data-action="quitar-opcion" data-idx="${i}" aria-label="Quitar respuesta">×</button>
        </div>`).join("")}
      <button class="ghost-button compact" type="button" data-action="agregar-opcion">+ Agregar respuesta</button>
    </div>`;
}
