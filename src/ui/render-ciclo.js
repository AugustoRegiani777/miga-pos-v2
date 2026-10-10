import { etiquetaUnidad } from "../utils/unidades.js";

// Los datos que le faltan a un insumo se completan ACA, en el mismo aviso que
// los detecta. Antes el aviso solo nombraba los insumos y mandaba a otra
// pantalla a buscarlos uno por uno; ahora cada pendiente trae el formulario
// minimo para resolverlo y desaparecer.
//
// "Minimo" es literal: solo se piden los campos sin los cuales el dato no
// sirve. El resto (stock minimo, precio exacto, cantidades finas) se ajusta
// despues en su pantalla, que para eso esta.

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function formularioProveedor(p, proveedores) {
  return `
    <div class="pendiente-form">
      <label>
        <span>¿A quién se lo comprás?</span>
        <select data-campo="proveedorId">
          ${proveedores.map((v) => `<option value="${esc(v.id)}">${esc(v.nombre)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>¿Cómo viene? <small>(como figura en la factura)</small></span>
        <input type="text" data-campo="nombreProducto" placeholder="${esc(p.insumoNombre)} 1 kg" value="${esc(p.insumoNombre)}">
      </label>
      <label>
        <span>¿Cómo te lo factura? <small>(la unidad del proveedor, no cómo lo contás vos)</small></span>
        <input type="text" data-campo="unidadCompra" placeholder="kg, bolsa, caja...">
      </label>
      <label>
        <span>Cuánto trae <small>(en ${esc(etiquetaUnidad(p.unidad))})</small></span>
        <input type="number" min="0" step="any" inputmode="decimal" data-campo="cantidadPorUnidad" placeholder="1000">
      </label>
      <label>
        <span>Precio por unidad (€)</span>
        <input type="number" min="0" step="0.01" inputmode="decimal" data-campo="precio" placeholder="0.00">
      </label>
    </div>`;
}

function formularioReceta(p, productos) {
  return `
    <div class="pendiente-form">
      <label>
        <span>¿En qué producto se usa?</span>
        <select data-campo="productoId">
          ${productos.map((x) => `<option value="${esc(x.id)}">${esc(x.nombre)}</option>`).join("")}
        </select>
      </label>
      <label>
        <span>Cuánto lleva una unidad <small>(en ${esc(etiquetaUnidad(p.unidad))})</small></span>
        <input type="number" min="0" step="any" inputmode="decimal" data-campo="cantidad" placeholder="25">
      </label>
    </div>`;
}

// Plegado por defecto, y a proposito.
//
// Esto empezo mostrando los seis formularios abiertos arriba de todo, con un
// triangulo de alerta. El dueño: "no las tengo, entonces el sistema no puede
// estorbarme con tantas tareas pendientes, debe ser mas discreto".
//
// Tenia razon. Estos pendientes son deuda que muchas veces NO se puede saldar
// en el momento — faltan las recetas de lo que hacen ellos, y no las van a
// inventar parados en la caja. Un aviso que ocupa media pantalla todos los
// dias por algo que no depende de vos no se lee: se aprende a ignorar, y el
// dia que diga algo urgente tampoco se va a leer.
//
// Entonces: una linea sola, sin alarma, que dice cuantos son. Se abre si lo
// tocas, y queda abierto o cerrado como lo dejaste (ver MOSTRAR_CICLO_KEY en
// app.js) — si no, guardar un pendiente lo volveria a cerrar justo cuando
// estas resolviendolos de a uno.
// Un producto en prueba se resuelve de dos maneras, y las dos son un toque:
//   "Se compra hecho"  -> pide proveedor y precio aca mismo y lo conecta
//   "Lo preparamos"    -> abre su hoja de edicion para armarle la receta
// No hay un "Guardar" suelto: el formulario de la compra aparece recien al
// elegir "Se compra hecho". Y "dejarlo asi" no es una accion: es no hacer nada,
// que es lo que el dueño quiere mientras sigue probando.
function articuloProducto(p, proveedores) {
  return `
      <article class="pendiente pendiente-producto" data-producto="${esc(p.productoId)}" data-falta="producto">
        <header class="pendiente-head">
          <div>
            <strong>${esc(p.productoNombre)}</strong>
            <span class="pendiente-falta">${esc(p.titulo)}</span>
          </div>
          <div class="pendiente-acciones">
            <button type="button" class="ghost-button compact" data-accion="producto-receta">Lo preparamos</button>
            <button type="button" class="ghost-button compact" data-accion="producto-reventa-abrir">Se compra hecho</button>
          </div>
        </header>
        <p class="pendiente-porque">${esc(p.porQue)}</p>
        <div class="pendiente-form pendiente-reventa" hidden>
          <label>
            <span>¿A quién se lo comprás?</span>
            <select data-campo="proveedorId">
              ${proveedores.map((v) => `<option value="${esc(v.id)}">${esc(v.nombre)}</option>`).join("")}
            </select>
          </label>
          <label>
            <span>Cómo figura en su factura</span>
            <input type="text" data-campo="nombreProducto" value="${esc(p.productoNombre)}">
          </label>
          <label>
            <span>Cómo te lo factura <small>(caja, bolsa, unidad...)</small></span>
            <input type="text" data-campo="unidadCompra" placeholder="caja">
          </label>
          <label>
            <span>Cuántas unidades trae</span>
            <input type="text" inputmode="decimal" data-campo="cantidadPorUnidad" placeholder="24">
          </label>
          <label>
            <span>Precio de esa caja o bolsa (€)</span>
            <input type="text" inputmode="decimal" data-campo="precio" placeholder="0,00">
          </label>
          <div class="pendiente-acciones" style="grid-column: 1 / -1;">
            <button type="button" class="ghost-button compact" data-accion="producto-reventa-guardar">Guardar</button>
          </div>
        </div>
        <p class="pendiente-error" hidden></p>
      </article>`;
}

export function renderPendientesCiclo(container, { pendientes, resumen, proveedores, productos, abierto = false }) {
  if (pendientes.length === 0) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }
  container.hidden = false;
  container.innerHTML = `
    <details class="aviso-ciclo-plegable"${abierto ? " open" : ""}>
      <summary class="aviso-ciclo-resumen">
        <span class="aviso-ciclo-conteo">${esc(resumen)}</span>
        <span class="aviso-ciclo-abrir">Completar</span>
      </summary>
      <p class="aviso-ciclo-ayuda">Cargalos cuando tengas el dato. Hasta entonces todo funciona igual: un insumo sin proveedor no entra en la lista de compras, y un producto en prueba se vende pero no descuenta insumos.</p>
    ${pendientes.map((p) => p.falta === "producto" ? articuloProducto(p, proveedores) : `
      <article class="pendiente" data-insumo="${esc(p.insumoId)}" data-falta="${esc(p.falta)}">
        <header class="pendiente-head">
          <div>
            <strong>${esc(p.insumoNombre)}</strong>
            <span class="pendiente-falta">${esc(p.titulo)}</span>
          </div>
          <div class="pendiente-acciones">
            <button type="button" class="ghost-button compact pendiente-descartar" data-accion="descartar">No lo uso</button>
            <button type="button" class="ghost-button compact" data-accion="guardar">Guardar</button>
          </div>
        </header>
        <p class="pendiente-porque">${esc(p.porQue)} <span class="cal-muted">Si ya no lo us&aacute;s, "No lo uso" lo saca de la lista y el aviso desaparece.</span></p>
        ${p.falta === "proveedor" ? formularioProveedor(p, proveedores) : formularioReceta(p, productos)}
        <p class="pendiente-error" hidden></p>
      </article>`).join("")}
    </details>`;
}

// Lee un pendiente del DOM. Devuelve { datos } o { error } con el motivo.
export function leerPendiente(article) {
  const valor = (campo) => article.querySelector(`[data-campo="${campo}"]`)?.value?.trim() ?? "";
  const numero = (campo) => parseFloat(String(valor(campo)).replace(",", "."));
  const falta = article.dataset.falta;

  if (falta === "proveedor") {
    const cantidadPorUnidad = numero("cantidadPorUnidad");
    const precio = numero("precio");
    if (!valor("proveedorId")) return { error: "Elegí el proveedor." };
    if (!valor("unidadCompra")) return { error: "Poné cómo viene (kg, bolsa, caja...)." };
    if (!Number.isFinite(cantidadPorUnidad) || cantidadPorUnidad <= 0) return { error: "Falta cuánto trae cada unidad." };
    if (!Number.isFinite(precio) || precio < 0) return { error: "Falta el precio." };
    return {
      datos: {
        insumoId: article.dataset.insumo,
        proveedorId: valor("proveedorId"),
        nombreProducto: valor("nombreProducto") || article.dataset.insumo,
        unidadCompra: valor("unidadCompra"),
        cantidadPorUnidad,
        precioUnitarioCentavos: Math.round(precio * 100)
      }
    };
  }

  const cantidad = numero("cantidad");
  if (!valor("productoId")) return { error: "Elegí el producto." };
  if (!Number.isFinite(cantidad) || cantidad <= 0) return { error: "Falta cuánto lleva una unidad." };
  return { datos: { insumoId: article.dataset.insumo, productoId: valor("productoId"), cantidad } };
}
