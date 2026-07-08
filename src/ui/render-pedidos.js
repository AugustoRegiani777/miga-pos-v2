import { centsToMoney } from "../utils/format.js";
import { EDIT_ICON, DELETE_ICON, SHARE_ICON } from "./icons.js";

function el(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fmtRetiro(isoString) {
  const d = new Date(isoString);
  const diaNombre = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"][d.getDay()];
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const hora = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  return `${diaNombre} ${dia}/${mes} ${hora}`;
}

function estadoPill(estado) {
  if (estado === "entregado") return { className: "ok", label: "Entregado" };
  if (estado === "listo") return { className: "low", label: "Listo para retirar" };
  return { className: "out", label: "Pendiente" };
}

// Texto plano para compartir el pedido por mail/WhatsApp/lo que sea instalado.
export function formatPedidoTicket(pedido) {
  const lineas = [
    `Pedido - ${pedido.clienteNombre}`,
    `Retira: ${fmtRetiro(pedido.fechaHoraRetiro)}`,
    "",
    ...pedido.items.map((item) => `${item.cantidad}x ${item.nombre}`),
    "",
    `Total: ${centsToMoney(pedido.totalCentavos)}`,
    pedido.pagado ? "Pagado" : "No pagado"
  ];
  if (pedido.cortadoMitad) lineas.push("Cortado a la mitad");
  if (pedido.aclaraciones) lineas.push(`Aclaraciones: ${pedido.aclaraciones}`);
  return lineas.join("\n");
}

export function renderPedidosGrid(container, pedidos, { onMarcarListo, onMarcarEntregado, onEditarPedido, onBorrarPedido, onCompartirPedido, expandedPedidoIds, onToggleItems }) {
  container.innerHTML = "";
  if (pedidos.length === 0) {
    container.textContent = "No hay pedidos cargados.";
    container.classList.add("empty");
    return;
  }
  container.classList.remove("empty");

  for (const pedido of pedidos) {
    const pill = estadoPill(pedido.estado);
    const card = el("article", "pedido-card");
    card.innerHTML = `
      <div class="pedido-card-header">
        <strong></strong>
        <span class="stock-pill"></span>
      </div>
      <div class="pedido-card-actions">
        <button type="button" class="icon-button pedido-share" aria-label="Compartir pedido">${SHARE_ICON}</button>
        <button type="button" class="icon-button pedido-edit" aria-label="Editar pedido">${EDIT_ICON}</button>
        <button type="button" class="icon-button pedido-delete" aria-label="Borrar pedido">${DELETE_ICON}</button>
      </div>
      <p class="pedido-retiro"></p>
      <p class="pedido-precio"></p>
      <p class="pedido-pago"></p>
      <p class="pedido-cortado" hidden>Cortado a la mitad</p>
      <p class="pedido-aclaraciones"></p>
      <button type="button" class="ghost-button compact pedido-toggle-items">Ver pedido</button>
      <ul class="pedido-items" hidden></ul>
    `;
    card.querySelector("strong").textContent = pedido.clienteNombre;
    card.querySelector(".pedido-share").addEventListener("click", () => onCompartirPedido(pedido));
    card.querySelector(".pedido-edit").addEventListener("click", () => onEditarPedido(pedido));
    card.querySelector(".pedido-delete").addEventListener("click", () => onBorrarPedido(pedido));
    const pillNode = card.querySelector(".stock-pill");
    pillNode.classList.add(pill.className);
    pillNode.textContent = pill.label;
    card.querySelector(".pedido-retiro").textContent = `Retira: ${fmtRetiro(pedido.fechaHoraRetiro)}`;
    card.querySelector(".pedido-precio").textContent = centsToMoney(pedido.totalCentavos);
    card.querySelector(".pedido-pago").textContent = pedido.pagado ? "Pagado" : "No pagado";
    if (pedido.cortadoMitad) card.querySelector(".pedido-cortado").hidden = false;

    const aclaracionesNode = card.querySelector(".pedido-aclaraciones");
    if (pedido.aclaraciones) {
      aclaracionesNode.textContent = pedido.aclaraciones;
    } else {
      aclaracionesNode.remove();
    }

    const itemsList = card.querySelector(".pedido-items");
    for (const item of pedido.items) {
      itemsList.appendChild(el("li", "", `${item.cantidad}x ${item.nombre}`));
    }

    // El estado de "expandido" vive fuera de este render (en app.js) para que
    // sobreviva a los refrescos automaticos del polling — sin esto, cada 9s
    // se perdia y la lista se volvia a cerrar sola.
    const isExpanded = expandedPedidoIds?.has(pedido.id) ?? false;
    itemsList.hidden = !isExpanded;
    const toggleBtn = card.querySelector(".pedido-toggle-items");
    toggleBtn.textContent = isExpanded ? "Ocultar pedido" : "Ver pedido";
    toggleBtn.addEventListener("click", () => {
      onToggleItems(pedido.id);
      const nowExpanded = expandedPedidoIds?.has(pedido.id) ?? false;
      itemsList.hidden = !nowExpanded;
      toggleBtn.textContent = nowExpanded ? "Ocultar pedido" : "Ver pedido";
    });

    if (pedido.estado === "pendiente") {
      const btn = el("button", "primary-button compact", "Marcar listo");
      btn.type = "button";
      btn.addEventListener("click", () => onMarcarListo(pedido));
      card.appendChild(btn);
    } else if (pedido.estado === "listo") {
      const btn = el("button", "primary-button secondary compact", "Entregar");
      btn.type = "button";
      btn.addEventListener("click", () => onMarcarEntregado(pedido));
      card.appendChild(btn);
    }

    container.appendChild(card);
  }
}

// Picker en formato "Nombre - cantidad +": cada tap en + suma una unidad al pedido.
export function renderPedidoProductPicker(container, products, cartItems, onIncrement, onDecrement) {
  container.innerHTML = "";
  for (const product of products) {
    const cantidad = cartItems.get(product.id)?.cantidad || 0;
    const row = el("div", "pedido-product-row");
    row.innerHTML = `
      <div>
        <strong></strong>
        <div class="pedido-product-stock"></div>
      </div>
      <div class="qty-controls">
        <button type="button" data-action="minus" aria-label="Restar">-</button>
        <span></span>
        <button type="button" data-action="plus" aria-label="Sumar">+</button>
      </div>
    `;
    row.querySelector("strong").textContent = product.nombre;
    row.querySelector(".pedido-product-stock").textContent = `Stock: ${product.stockActual}`;
    row.querySelector("span").textContent = cantidad;
    row.querySelector('[data-action="plus"]').addEventListener("click", () => onIncrement(product));
    row.querySelector('[data-action="minus"]').addEventListener("click", () => onDecrement(product.id));
    container.appendChild(row);
  }
}

export function renderPedidoCart(container, totalNode, confirmButton, items, onQuantityChange) {
  container.innerHTML = "";
  if (items.size === 0) {
    container.textContent = "Sin productos.";
    container.classList.add("empty");
    totalNode.textContent = centsToMoney(0);
    confirmButton.disabled = true;
    return { totalCentavos: 0 };
  }
  container.classList.remove("empty");

  let total = 0;
  for (const item of items.values()) {
    total += item.precioUnitarioCentavos * item.cantidad;
    const line = el("div", "cart-line");
    line.innerHTML = `
      <div>
        <strong></strong>
        <div class="cart-unit"></div>
      </div>
      <div class="qty-controls">
        <button type="button" data-action="minus" aria-label="Restar">-</button>
        <span></span>
        <button type="button" data-action="plus" aria-label="Sumar">+</button>
      </div>
    `;
    line.querySelector("strong").textContent = item.nombre;
    line.querySelector(".cart-unit").textContent = `${centsToMoney(item.precioUnitarioCentavos)} c/u`;
    line.querySelector("span").textContent = item.cantidad;
    line.querySelector('[data-action="minus"]').addEventListener("click", () => onQuantityChange(item.productId, -1));
    line.querySelector('[data-action="plus"]').addEventListener("click", () => onQuantityChange(item.productId, 1));
    container.appendChild(line);
  }
  totalNode.textContent = centsToMoney(total);
  confirmButton.disabled = false;
  return { totalCentavos: total };
}
