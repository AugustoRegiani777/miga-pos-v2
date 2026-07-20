import { centsToMoney, normalizeText, stockStatus } from "../utils/format.js";
import { SHARE_ICON, PRINT_ICON, UNDO_ICON } from "./icons.js";

function el(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function productionPaletteForProduct(product) {
  if (product.id === "jamon-queso") return "jamon-queso";
  if (product.id === "pasta-oliva-queso") return "pasta-oliva";
  if (product.id === "pimiento-gouda-philp") return "pimientos";
  if (product.id === "pesto-tomate-queso") return "pesto";
  if (product.id === "berenjena-brie") return "berenjena";
  if (product.id === "jamon-serrano-rucula") return "jamon-serrano";
  if (product.id === "atun-palta-queso") return "atun";
  if (product.id === "huevo-jamon") return "salmon";
  if (product.id === "huevo-queso") return "huevo-queso";
  if (product.id === "especial-semanal") return "especial";
  if (product.id === "croissant") return "jamon-queso";
  if (product.id === "mini-croissant") return "pasta-oliva";
  if (product.id === "mini-croissant-ddl") return "pimientos";
  if (product.id === "pain-au-chocolat") return "pesto";
  if (product.id === "chipa") return "berenjena";
  return "";
}

function formatProductionTime(isoString) {
  if (!isoString) return "";
  return new Date(isoString).toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function productionSummaryLines(product) {
  if (!product.movimientosProduccion?.length) {
    return [`Produccion cargada hoy: ${product.cantidadProducida}`];
  }
  return product.movimientosProduccion.map((movement) => {
    const isStockErrorAdjustment = movement.tipo === "ajuste_stock" && (movement.motivo === "Error de produccion" || movement.motivo === "Error");
    const absoluteQuantity = Math.abs(Number(movement.cantidad) || 0);
    const quantityLabel = isStockErrorAdjustment
      ? `${movement.cantidad > 0 ? "Alta por error" : "Baja por error"}: ${absoluteQuantity}`
      : `${movement.cantidad} sandwiches`;
    const timeLabel = formatProductionTime(movement.creadoEn);
    return `${quantityLabel} ${timeLabel}hs`;
  });
}

export function renderProductGrid(container, categories, products, onProductClick) {
  container.innerHTML = "";
  for (const category of categories) {
    const section = el("section", "product-category");
    section.dataset.categorySection = "true";
    section.dataset.categoryName = category.nombre;
    section.appendChild(el("h2", "category-title", category.nombre));

    const grid = el("div", "product-grid");
    products
      .filter((product) => product.categoriaId === category.id)
      .forEach((product) => {
        const displayStock = product.stockDisponible ?? product.stockActual;
        const status = stockStatus({ ...product, stockActual: displayStock });
        const disabled = product.controlaStock && displayStock <= 0;
        const button = el("button", `product-button${disabled ? " disabled" : ""}`);
        button.type = "button";
        button.disabled = disabled;
        button.dataset.productId = product.id;
        button.dataset.name = product.nombre;
        button.dataset.category = category.nombre;
        button.dataset.price = product.precioCentavos;
        button.dataset.stock = displayStock;
        button.dataset.controlsStock = product.controlaStock ? "1" : "0";
        button.innerHTML = product.controlaStock
          ? `
            <span class="product-name"></span>
            <span class="product-meta"></span>
            <span class="stock-pill ${status.className}"></span>
          `
          : `
            <span class="product-name"></span>
            <span class="product-meta"></span>
          `;
        button.querySelector(".product-name").textContent = product.nombre;
        button.querySelector(".product-meta").textContent = centsToMoney(product.precioCentavos);
        if (product.controlaStock) {
          button.querySelector(".stock-pill").textContent = `${displayStock} disp.`;
        }
        button.addEventListener("click", () => onProductClick(product));
        grid.appendChild(button);
      });

    section.appendChild(grid);
    container.appendChild(section);
  }
}

export function renderCart(container, sandwichCountNode, totalNode, confirmButton, cart, onQuantityChange, pricing) {
  container.innerHTML = "";
  sandwichCountNode.textContent = `Sandwiches en carrito: ${pricing?.sandwichQuantity || 0}`;

  if (cart.size === 0) {
    container.textContent = "Sin productos.";
    container.classList.add("empty");
    totalNode.textContent = centsToMoney(0);
    confirmButton.disabled = true;
    return;
  }

  container.classList.remove("empty");
  for (const item of cart.values()) {
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
    line.querySelector("strong").textContent = item.displayName || item.nombre;
    line.querySelector(".cart-unit").textContent = item.saleMode === "togoo" && item.controlaStock
      ? "ToGoo — incluido en tarifa fija"
      : `${centsToMoney(item.precioCentavos)} c/u`;
    line.querySelector("span").textContent = item.quantity;
    line.querySelector('[data-action="minus"]').addEventListener("click", () => onQuantityChange(item.cartKey, -1));
    line.querySelector('[data-action="plus"]').addEventListener("click", () => onQuantityChange(item.cartKey, 1));
    container.appendChild(line);
  }

  if (pricing?.combo) {
    const comboLine = el("div", "combo-summary");
    comboLine.innerHTML = `
      <strong></strong>
      <span></span>
      <small></small>
    `;
    comboLine.querySelector("strong").textContent = pricing.combo.nombre;
    comboLine.querySelector("span").textContent = centsToMoney(pricing.combo.precioCentavos);
    comboLine.querySelector("small").textContent = `Valor real del combo: ${centsToMoney(pricing.comboNormalCentavos)}`;
    container.appendChild(comboLine);
  } else if (pricing?.warning) {
    const warning = el("p", "combo-warning", pricing.warning);
    container.appendChild(warning);
  }

  totalNode.textContent = centsToMoney(pricing?.totalCentavos ?? 0);
  confirmButton.disabled = false;
}

export function filterProductButtons(searchInput, emptyNode) {
  const term = normalizeText(searchInput.value.trim());
  let visibleCount = 0;
  document.querySelectorAll("[data-category-section]").forEach((section) => {
    let sectionVisible = false;
    section.querySelectorAll(".product-button").forEach((button) => {
      const text = `${button.dataset.name} ${button.dataset.category}`;
      const matches = normalizeText(text).includes(term);
      button.hidden = !matches;
      sectionVisible = sectionVisible || matches;
      if (matches) visibleCount += 1;
    });
    section.hidden = !sectionVisible;
  });
  emptyNode.hidden = visibleCount > 0;
}

function saleTitle(sale) {
  if (sale.origen === "pedido" && sale.clienteNombre) return `Pedido: ${sale.clienteNombre}`;
  if (sale.saleMode === "baja") return `Baja #${sale.id}`;
  if (sale.saleMode === "togoo") return `ToGoo #${sale.id}`;
  return `Venta #${sale.id}`;
}

// Texto plano del ticket, para compartir (mail/WhatsApp/etc) o imprimir.
export function formatVentaTicket(sale) {
  const lineas = [
    saleTitle(sale),
    `${sale.fecha} - ${sale.hora}`,
    "",
    ...sale.detalles.map((d) => `${d.cantidad}x ${d.productoNombre} - ${centsToMoney(d.subtotalCentavos)}`),
    "",
    `Total: ${centsToMoney(sale.totalCentavos)}`
  ];
  return lineas.join("\n");
}

function renderProductionRow(product, selectedProductId, onProductionProductSelect, onAdjustStock) {
  const wrapper = el("div", "production-row-wrapper");
  const stockBtn = el("button", "ghost-button compact production-stock-button", "Modificar stock");
  stockBtn.type = "button";
  stockBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    onAdjustStock(product);
  });
  wrapper.appendChild(
    renderStockRow(
      product,
      productionSummaryLines(product),
      {
        clickable: true,
        selected: product.id === selectedProductId,
        onClick: () => onProductionProductSelect(product)
      }
    )
  );
  wrapper.appendChild(stockBtn);
  return wrapper;
}

export function renderProduction(snapshot, selectedBox, selectedProductId, onProductionProductSelect, productionLists, onAdjustStock) {
  const selectedProduct = snapshot.productionProducts.find((product) => product.id === selectedProductId);
  selectedBox.innerHTML = selectedProduct
    ? `
      <strong></strong>
      <small></small>
    `
    : `
      <span>Selecciona un producto desde la lista</span>
      <small>Toca un sandwich para abrir la carga de produccion.</small>
    `;
  if (selectedProduct) {
    selectedBox.querySelector("strong").textContent = selectedProduct.nombre;
    selectedBox.querySelector("small").textContent = `Stock actual: ${selectedProduct.stockActual}. Hoy cargado: ${selectedProduct.cantidadProducida}.`;
  }

  productionLists.sandwiches.innerHTML = "";
  for (const product of snapshot.sandwiches) {
    productionLists.sandwiches.appendChild(
      renderProductionRow(product, selectedProductId, onProductionProductSelect, onAdjustStock)
    );
  }

  if (productionLists.bolleria) {
    productionLists.bolleria.innerHTML = "";
    for (const product of snapshot.bolleria) {
      productionLists.bolleria.appendChild(
        renderProductionRow(product, selectedProductId, onProductionProductSelect, onAdjustStock)
      );
    }
  }
}

// "Modo consulta": listas de solo lectura, sin formularios ni carrito, para
// dispositivos que solo miran el estado del local (no operan).
export function renderStockConsulta(container, products) {
  container.innerHTML = "";
  if (products.length === 0) {
    container.appendChild(el("p", "empty-state", "Sin productos."));
    return;
  }
  for (const product of products) {
    const row = el("article", "stock-row");
    row.innerHTML = `
      <div>
        <h2></h2>
        <p></p>
      </div>
      <strong></strong>
    `;
    row.querySelector("h2").textContent = product.nombre;
    row.querySelector("p").textContent = centsToMoney(product.precioCentavos);
    row.querySelector("strong").textContent = product.stockActual;
    container.appendChild(row);
  }
}

export function renderProduccionConsulta(container, products) {
  container.innerHTML = "";
  if (products.length === 0) {
    container.appendChild(el("p", "empty-state", "Sin productos."));
    return;
  }
  for (const product of products) {
    const row = el("article", "stock-row");
    row.innerHTML = `
      <div>
        <h2></h2>
        <div class="stock-row-total"></div>
      </div>
      <strong></strong>
    `;
    row.querySelector("h2").textContent = product.nombre;
    row.querySelector(".stock-row-total").textContent = `Producido hoy: ${product.cantidadProducida}`;
    row.querySelector("strong").textContent = product.stockActual;
    container.appendChild(row);
  }
}

export function renderHistory(container, sales, { onUndoSale, onShareSale, onPrintSale } = {}) {
  container.innerHTML = "";
  if (sales.length === 0) {
    container.appendChild(el("p", "empty-state", "No hay ventas registradas para esta fecha."));
    return;
  }

  for (const sale of sales) {
    const row = el("article", "sale-row");
    row.innerHTML = `
      <div class="sale-main">
        <div>
          <h2></h2>
          <p></p>
        </div>
        <strong></strong>
      </div>
      <ul></ul>
      <div class="sale-actions">
        <button type="button" class="icon-button sale-share" aria-label="Compartir venta">${SHARE_ICON}</button>
        <button type="button" class="icon-button sale-print" aria-label="Imprimir ticket">${PRINT_ICON}</button>
        <button type="button" class="icon-button sale-undo" aria-label="Deshacer venta">${UNDO_ICON}</button>
      </div>
    `;
    row.querySelector("h2").textContent = saleTitle(sale);
    row.querySelector("p").textContent = `${sale.fecha} - ${sale.hora}`;
    row.querySelector("strong").textContent = centsToMoney(sale.totalCentavos);
    const list = row.querySelector("ul");
    for (const detail of sale.detalles) {
      const item = document.createElement("li");
      item.textContent = `${detail.cantidad} x ${detail.productoNombre} - ${centsToMoney(detail.subtotalCentavos)}`;
      list.appendChild(item);
    }
    row.querySelector(".sale-share").addEventListener("click", () => onShareSale?.(sale));
    row.querySelector(".sale-print").addEventListener("click", () => onPrintSale?.(sale));
    if (onUndoSale) {
      row.querySelector(".sale-undo").addEventListener("click", () => onUndoSale(sale));
    } else {
      row.querySelector(".sale-undo").remove();
    }
    container.appendChild(row);
  }
}

function renderStockRow(product, subtitle, options = {}) {
  const tagName = options.clickable ? "button" : "article";
  const row = el(tagName, `stock-row${options.clickable ? " production-row" : ""}${options.selected ? " selected" : ""}`);
  const palette = options.clickable ? productionPaletteForProduct(product) : "";
  if (options.clickable) {
    row.dataset.categoryId = product.categoriaId || "";
  }
  if (palette) {
    row.dataset.palette = palette;
  }
  if (options.clickable) {
    row.type = "button";
    row.addEventListener("click", options.onClick);
  }
  row.innerHTML = `
    <div>
      <h2></h2>
      <span class="production-cta"></span>
      <div class="stock-row-total"></div>
      <p></p>
    </div>
    <div class="stock-row-actions"></div>
    <strong></strong>
  `;
  row.querySelector("h2").textContent = product.nombre;
  const ctaNode = row.querySelector(".production-cta");
  if (options.clickable) {
    ctaNode.textContent = "Cargar producción";
  } else {
    ctaNode.remove();
  }
  const totalNode = row.querySelector(".stock-row-total");
  if (options.clickable) {
    totalNode.textContent = `Total hoy: ${product.cantidadProducida}`;
  } else {
    totalNode.remove();
  }
  const subtitleNode = row.querySelector("p");
  if (Array.isArray(subtitle)) {
    subtitleNode.innerHTML = subtitle.map((line) => `<span>${line}</span>`).join("");
  } else {
    subtitleNode.textContent = subtitle;
  }
  const actionsNode = row.querySelector(".stock-row-actions");
  if (options.actionLabel && typeof options.onAction === "function") {
    const actionButton = el("button", "ghost-button stock-adjust-button", options.actionLabel);
    actionButton.type = "button";
    actionButton.addEventListener("click", options.onAction);
    actionsNode.appendChild(actionButton);
  }
  row.querySelector("strong").textContent = product.stockActual;
  return row;
}
