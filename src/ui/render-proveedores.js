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
          <button class="ghost-button compact" data-action="delete-prod" data-id="${p.id}" data-provid="${proveedor.id}">Eliminar</button>
        </td>
      </tr>`).join("");

    const tablaHTML = proveedor.productos.length
      ? `<div class="prov-table-wrap">
          <table class="prov-tabla">
            <thead><tr><th>Insumo</th><th>Unidad compra</th><th>Precio</th><th>Precio base</th><th></th></tr></thead>
            <tbody>${filasProducto}</tbody>
          </table>
         </div>`
      : "<p class='cal-muted' style='padding:0.5rem 0'>Sin insumos registrados.</p>";

    return `
      <details class="prov-card" data-prov-id="${proveedor.id}">
        <summary class="prov-summary">
          <div class="prov-summary-main">
            <strong>${proveedor.nombre}</strong>
            <span class="cal-muted">${proveedor.productos.length} insumo${proveedor.productos.length !== 1 ? "s" : ""} · ${cicloTexto}</span>
          </div>
          <button class="ghost-button compact prov-edit-btn" data-action="edit-prov" data-id="${proveedor.id}">Editar</button>
        </summary>
        <div class="prov-detail">
          ${contacto ? `<p class="prov-contact">${contacto}</p>` : ""}
          ${proveedor.notas ? `<p class="cal-muted prov-notas">${proveedor.notas}</p>` : ""}
          ${tablaHTML}
          <div class="prov-add-row">
            <button class="ghost-button compact" data-action="add-prod" data-provid="${proveedor.id}">+ Agregar insumo</button>
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

    if (action === "delete-prod") {
      const proveedor = data.find(p => p.id === btn.dataset.provid);
      const prod = proveedor?.productos.find(p => p.id === btn.dataset.id);
      if (prod) callbacks.onDeleteProd?.(prod);
    }
  }, { once: false });
}

// Seleccion de productos para la receta de un insumo. Antes era una fila por
// producto (un desplegable + una cantidad, repetido): para la mezcla, la
// mayonesa o la miga, que van en TODOS los sandwiches, eran 12 pasadas por una
// lista larga. Ahora hay un chip por categoria que marca todos los suyos de un
// toque, y abajo la lista con casillas para desmarcar los que no van y sumar de
// otra categoria (es acumulativo: marcar Cafe no borra los sandwiches).
//
// La cantidad NO vive aca: es un unico campo estatico en index.html
// (#prov-prod-receta-cantidad), fuera de este contenedor, para que no se pierda
// lo tecleado cuando la lista se repinta.
//
// Dos funciones a proposito: renderProvProdRecetaRows arma el HTML una sola vez
// (al abrir la sheet) y aplicarProvProdRecetaSeleccion sincroniza casillas,
// contadores y chips desde el estado sin reconstruir nada. Reconstruir en cada
// tap perdia la posicion del scroll y cerraba los grupos que la persona habia
// abierto, justo cuando estaba desmarcando de a uno.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Agrupa respetando el orden que ya trae listProducts() (categoria.orden y
// despues producto.orden), asi los chips salen en el orden de la carta.
function agruparPorCategoria(productos) {
  const grupos = [];
  const porNombre = new Map();
  for (const producto of productos) {
    const nombre = producto.categoria || "Sin categoria";
    let grupo = porNombre.get(nombre);
    if (!grupo) {
      grupo = { nombre, productos: [] };
      porNombre.set(nombre, grupo);
      grupos.push(grupo);
    }
    grupo.productos.push(producto);
  }
  return grupos;
}

// yaEnReceta: Map productoId -> texto de la cantidad que ya tiene cargada
// ("25 ml"). Solo se usa al editar un insumo que ya existe: esas lineas se
// muestran como ya puestas, con su cantidad a la vista, y el campo unico de
// cantidad se aplica solo a las que se agreguen.
export function renderProvProdRecetaRows(container, vinculos, productos, { yaEnReceta = new Map() } = {}) {
  if (!productos.length) {
    container.innerHTML = "<p class='cal-muted' style='padding:0.25rem 0'>No hay productos activos a los que agregarselo.</p>";
    return;
  }

  const grupos = agruparPorCategoria(productos);

  const chips = grupos.map((grupo, i) => `
    <button type="button" class="receta-chip" data-action="toggle-categoria" data-grupo="${i}" aria-pressed="false">
      <span class="receta-chip-nombre">${esc(grupo.nombre)}</span>
      <span class="receta-chip-n" data-chip-n="${i}">${grupo.productos.length}</span>
    </button>`).join("");

  const listas = grupos.map((grupo, i) => `
    <details class="receta-sel-grupo" data-grupo="${i}">
      <summary class="receta-sel-grupo-summary">
        <span>${esc(grupo.nombre)}</span>
        <span class="cal-muted receta-sel-grupo-n" data-grupo-n="${i}">0 de ${grupo.productos.length}</span>
      </summary>
      <div class="receta-sel-items">
        ${grupo.productos.map((producto) => {
          const ya = yaEnReceta.get(producto.id);
          return `
        <label class="receta-sel-item${ya ? " receta-sel-item-ya" : ""}">
          <input type="checkbox" class="receta-sel-check" data-producto-id="${esc(producto.id)}"${ya ? ' data-ya="1" checked' : ""}>
          <span class="receta-sel-item-nombre">${esc(producto.nombre)}</span>
          ${ya ? `<span class="receta-sel-item-ya-tag">ya lleva ${esc(ya)}</span>` : ""}
        </label>`;
        }).join("")}
      </div>
    </details>`).join("");

  container.innerHTML = `
    <div class="receta-sel">
      <div class="receta-sel-chips" role="group" aria-label="Marcar todos los productos de una categoria">${chips}</div>
      <div class="receta-sel-resumen">
        <strong class="receta-sel-total" data-rol="total" aria-live="polite">Ninguno seleccionado</strong>
        <button type="button" class="ghost-button compact" data-action="limpiar-seleccion" hidden>Quitar todos</button>
      </div>
      <div class="receta-sel-listas">${listas}</div>
    </div>`;

  aplicarProvProdRecetaSeleccion(container, vinculos, productos, { yaEnReceta });
}

// Pinta el estado sobre el HTML ya existente: casillas, "4 de 12" por grupo,
// chips (prendido = todos marcados, parcial = algunos) y el total. Idempotente:
// el DOM siempre se deriva del array de vinculos, nunca al reves.
export function aplicarProvProdRecetaSeleccion(container, vinculos, productos, { yaEnReceta = new Map() } = {}) {
  const marcados = new Set(vinculos.map((v) => v.productoId));
  container.querySelectorAll(".receta-sel-check").forEach((chk) => {
    if (chk.dataset.ya === "1") return; // linea ya cargada: no se toca desde aca
    chk.checked = marcados.has(chk.dataset.productoId);
  });

  const grupos = agruparPorCategoria(productos);
  grupos.forEach((grupo, i) => {
    const seleccionables = grupo.productos.filter((p) => !yaEnReceta.has(p.id));
    const cuantos = seleccionables.filter((p) => marcados.has(p.id)).length;
    const total = seleccionables.length;
    const yaCuantos = grupo.productos.length - total;

    const contador = container.querySelector(`[data-grupo-n="${i}"]`);
    if (contador) {
      contador.textContent = total === 0
        ? `${yaCuantos} ya en su receta`
        : `${cuantos} de ${total}${yaCuantos ? ` (+${yaCuantos} ya)` : ""}`;
    }

    const chip = container.querySelector(`.receta-chip[data-grupo="${i}"]`);
    if (!chip) return;
    const todos = total > 0 && cuantos === total;
    chip.setAttribute("aria-pressed", todos ? "true" : "false");
    chip.classList.toggle("activo", todos);
    chip.classList.toggle("parcial", cuantos > 0 && !todos);
    chip.disabled = total === 0;
    const chipN = chip.querySelector(`[data-chip-n="${i}"]`);
    if (chipN) chipN.textContent = cuantos > 0 ? `${cuantos}/${total}` : String(total || grupo.productos.length);
  });

  const n = marcados.size;
  const totalEl = container.querySelector('[data-rol="total"]');
  if (totalEl) {
    totalEl.textContent = n === 0
      ? "Ninguno seleccionado"
      : n === 1 ? "1 producto seleccionado" : `${n} productos seleccionados`;
  }
  const limpiar = container.querySelector('[data-action="limpiar-seleccion"]');
  if (limpiar) limpiar.hidden = n === 0;
}

export function renderProvProdInsumoSelect(selectEl, insumos, selectedId) {
  selectEl.innerHTML =
    `<option value="">— ninguno (para reventa) —</option>` +
    insumos
      .filter(i => i.activo)
      .sort((a, b) => a.nombre.localeCompare(b.nombre))
      .map(i => `<option value="${i.id}" data-unidad="${esc(i.unidad)}" ${i.id === selectedId ? "selected" : ""}>${esc(i.nombre)} (${esc(i.unidad)})</option>`)
      .join("") +
    `<option value="__nuevo__" ${selectedId === "__nuevo__" ? "selected" : ""}>+ Crear insumo nuevo…</option>`;
}
