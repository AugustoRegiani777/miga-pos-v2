import { minimoSugerido, UNIDADES_ANTES_DE_REPONER } from "../modules/catalogo-armar.js";
import { opcionesUnidadBase } from "../utils/unidades.js";

function fmtEur(centavos) {
  return (centavos / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// Ojo cerrado: el icono de "ocultos".
const ICONO_OCULTO = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.1A10.6 10.6 0 0 1 12 5c5 0 8.7 3.4 10 7a11.8 11.8 0 0 1-3 4.3M6.2 6.3C4 7.8 2.6 9.9 2 12c1.3 3.6 5 7 10 7a10.4 10.4 0 0 0 4-.8"/></svg>';

// Categorias cuya lista de ocultos esta desplegada. Vive aca (y no en el HTML) porque la lista se
// vuelve a dibujar entera cada vez, y al tocar "Mostrar" tiene que seguir abierta.
const categoriasConOcultosAbiertos = new Set();

export function renderMenuList(el, categorias, callbacks = {}) {
  if (!categorias.length) {
    el.innerHTML = "<p class='empty-state'>No hay categorias cargadas.</p>";
    return;
  }

  el.innerHTML = categorias.map(categoria => {
    // Lo que se ve y se vende arriba; lo oculto, plegado al lado del nombre de la categoria.
    const visibles = categoria.productos.filter((p) => p.activo);
    const ocultos = categoria.productos.filter((p) => !p.activo);
    const filas = visibles.map((producto, index) => {
      const ocultoBadge = "";
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

    const tablaHTML = visibles.length
      ? `<div class="prov-table-wrap">
          <table class="prov-tabla">
            <thead><tr><th class="celda-asa"></th><th>Producto</th><th>Precio</th><th></th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
         </div>`
      : `<p class='cal-muted' style='padding:0.5rem 0'>${ocultos.length ? "Todos los productos de esta categoria estan ocultos." : "Sin productos en esta categoria."}</p>`;

    const abierto = categoriasConOcultosAbiertos.has(categoria.id);
    const ocultosBtn = ocultos.length
      ? `<button type="button" class="menu-ocultos-btn" data-action="toggle-ocultos" data-catid="${categoria.id}" aria-expanded="${abierto}" title="Productos ocultos: no aparecen en Caja" aria-label="${ocultos.length} oculto${ocultos.length !== 1 ? "s" : ""}">${ICONO_OCULTO}<span>${ocultos.length}</span></button>`
      : "";
    const ocultosPanel = ocultos.length
      ? `<div class="menu-ocultos" data-ocultos-de="${categoria.id}" ${abierto ? "" : "hidden"}>
          <p class="cal-muted menu-ocultos-titulo">Ocultos (no aparecen en Caja)</p>
          ${ocultos.map((p) => `
            <div class="menu-oculto-fila">
              <span class="menu-oculto-nombre">${p.nombre} <span class="cal-muted">${fmtEur(p.precioCentavos)}</span></span>
              <span class="menu-oculto-acciones">
                <button class="ghost-button compact" type="button" data-action="toggle-activo" data-id="${p.id}">Mostrar</button>
                <button class="ghost-button compact" type="button" data-action="edit-producto" data-id="${p.id}">Editar</button>
              </span>
            </div>`).join("")}
        </div>`
      : "";

    return `
      <details class="prov-card" open data-categoria-id="${categoria.id}">
        <summary class="prov-summary">
          <div class="prov-summary-main">
            <span class="menu-cat-titulo"><strong>${categoria.nombre}</strong>${ocultosBtn}</span>
            <span class="cal-muted">${visibles.length} producto${visibles.length !== 1 ? "s" : ""}</span>
          </div>
        </summary>
        <div class="prov-detail">
          ${ocultosPanel}
          ${tablaHTML}
          <div class="prov-add-row">
            <button class="ghost-button compact menu-agregar" type="button" data-action="add-producto" data-catid="${categoria.id}">+ Agregar producto</button>
          </div>
          ${categoria.id === "sandwiches" ? '<div class="menu-cat-slot" data-slot="promos"></div>' : ""}
        </div>
      </details>`;
  }).join("");

  // onclick (y no addEventListener): la lista se dibuja muchas veces sobre el mismo elemento y los
  // oyentes se iban acumulando, uno por cada dibujo.
  el.onclick = (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    e.stopPropagation();
    const action = btn.dataset.action;

    if (action === "toggle-ocultos") {
      e.preventDefault(); // dentro del titulo de la categoria: no la pliega
      const id = btn.dataset.catid;
      const panel = el.querySelector(`[data-ocultos-de="${id}"]`);
      const abre = !categoriasConOcultosAbiertos.has(id);
      if (abre) categoriasConOcultosAbiertos.add(id); else categoriasConOcultosAbiertos.delete(id);
      if (panel) panel.hidden = !abre;
      btn.setAttribute("aria-expanded", String(abre));
      return;
    }

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
  };
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
//
// Eso SOLO aplica si ESTE producto usa ese grupo (el selector "Que se pregunta al
// venderlo"). Si no lo usa, la receta descuenta el insumo elegido tal cual y las
// otras opciones no intervienen para nada; mostrar sus cantidades igual hacia
// pensar que se descontaban todas ("me preocupa que descuente de las tres").
// En ese caso se dice claramente que no.
function lineaVarianteCantidades(linea, grupos, insumos, index, grupoElegidoId = "") {
  const grupo = grupos.find((g) => (g.opciones || []).some((o) => o.insumoId === linea.insumoId));
  if (!grupo) return "";
  if (grupo.id !== grupoElegidoId) {
    const nombre = insumos.find((i) => i.id === linea.insumoId)?.nombre || "este insumo";
    return `<p class="cal-muted menu-receta-sin-variante">Se descuenta solo ${nombre}. Este producto no pregunta "${grupo.nombre}" al venderlo.</p>`;
  }
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
// El dueño creo "lengua carne" para un sandwich nuevo y el insumo quedo a medias:
// sin minimo (los campos estaban vacios -> 0) y sin proveedor, porque habia que
// ir a OTRA pantalla a asignarselo. Sus palabras: "podria haberme ofrecido antes
// que le asigne proveedor". Tenia razon: el dato se pide donde se crea la cosa.
//
// El minimo se PROPONE calculado (minimoSugerido, en catalogo-armar.js) en vez
// de pedirse en frio. Se muestra en el campo para que se vea y se pueda cambiar:
// no es un default escondido.

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
          <option value="__nuevo__" ${elegido === "__nuevo__" ? "selected" : ""}>+ Proveedor nuevo…</option>
        </select>
      </label>
      ${elegido === "__nuevo__" ? `
        <div class="menu-receta-nuevo-fields">
          <input class="menu-receta-nuevo-prov-quien-nombre" data-idx="${index}" type="text" placeholder="Nombre del proveedor" value="${linea.nuevoProveedorNombre ?? ""}">
          <input class="menu-receta-nuevo-prov-dias" data-idx="${index}" type="number" min="1" step="1" inputmode="numeric" placeholder="Cada cuántos días le pedís (7)" value="${linea.nuevoProveedorDias ?? ""}">
        </div>` : ""}
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

// Al salir del campo "cantidad" de un insumo nuevo cambia el minimo que se
// propone. Eso se actualiza EN SU LUGAR: volver a dibujar toda la lista (lo que
// se hacia) reemplazaba los campos justo cuando la persona tocaba el siguiente,
// y lo que estaba escribiendo se perdia.
export function actualizarSugeridoEnSitio(container, linea, index) {
  const fila = container.querySelector(`.menu-receta-row[data-idx="${index}"]`);
  const min = fila?.querySelector(".menu-receta-nuevo-min");
  if (!min) return;
  const critico = fila.querySelector(".menu-receta-nuevo-critico");
  const ayuda = fila.querySelector(".menu-receta-nuevo-ayuda");
  const sugerido = minimoSugerido(linea.cantidad);
  min.placeholder = `Mínimo${sugerido ? `: ${sugerido}` : ""}`;
  critico.placeholder = `Crítico${sugerido ? `: ${Math.round(sugerido / 2)}` : ""}`;
  // Solo se mueve el valor si la persona no lo escribio ella.
  if (linea.nuevoStockMinimo === undefined) min.value = sugerido ?? "";
  if (linea.nuevoStockCritico === undefined) critico.value = sugerido ? Math.round(sugerido / 2) : "";
  if (ayuda) {
    ayuda.textContent = sugerido
      ? `Calculado para ${UNIDADES_ANTES_DE_REPONER} unidades antes de reponer. Cambialo si querés.`
      : "Poné primero la cantidad y te propongo un mínimo.";
  }
}

export function renderMenuRecetaRows(container, lineas, insumos, grupos = [], proveedores = [], grupoElegidoId = "") {
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
            <select class="menu-receta-nuevo-unidad" data-idx="${index}" aria-label="Unidad en la que lo gastás">${opcionesUnidadBase(linea.nuevaUnidad)}</select>
          </div>
          <div class="menu-receta-nuevo-fields">
            <input class="menu-receta-nuevo-min" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Mínimo${sugerido ? `: ${sugerido}` : ""}" value="${linea.nuevoStockMinimo ?? (sugerido ?? "")}">
            <input class="menu-receta-nuevo-critico" data-idx="${index}" type="number" min="0" step="any" inputmode="decimal" placeholder="Crítico${sugerido ? `: ${Math.round(sugerido / 2)}` : ""}" value="${linea.nuevoStockCritico ?? (sugerido ? Math.round(sugerido / 2) : "")}">
          </div>
          <p class="menu-receta-nuevo-ayuda cal-muted">${sugerido
            ? `Calculado para ${UNIDADES_ANTES_DE_REPONER} unidades antes de reponer. Cambialo si querés.`
            : "Poné primero la cantidad y te propongo un mínimo."}</p>
          ${bloqueProveedorNuevo(linea, index, proveedores)}` : ""}
        ${lineaVarianteCantidades(linea, grupos, insumos, index, grupoElegidoId)}
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
      .join("") +
    // Si la respuesta es un insumo que todavia no existe se crea ACA, sin
    // cancelar el producto para irse a otra pantalla. Usa el mismo camino que
    // cualquier insumo nuevo (construirInsumoNuevo), asi que nace con minimo y
    // queda anotado en Completar si le falta el proveedor.
    `<option value="__nuevo__" ${seleccionado === "__nuevo__" ? "selected" : ""}>+ Crear insumo nuevo…</option>`;

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
        </div>
        ${o.insumoId === "__nuevo__" ? `
        <div class="menu-variante-opcion-nuevo" data-idx="${i}">
          <input class="menu-variante-nuevo-nombre" data-idx="${i}" type="text" placeholder="Nombre del insumo nuevo" value="${o.nuevoInsumo?.nombre ?? ""}">
          <select class="menu-variante-nuevo-unidad" data-idx="${i}" aria-label="Unidad en la que lo gastás">${opcionesUnidadBase(o.nuevoInsumo?.unidad)}</select>
        </div>` : ""}`).join("")}
      <button class="ghost-button compact" type="button" data-action="agregar-opcion">+ Agregar respuesta</button>
    </div>`;
}
