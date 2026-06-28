import { exportSalesSummary } from "../modules/backup.js";
import { calculateCartPricing } from "../modules/pricing.js";
import {
  adjustStockLevel,
  confirmSale,
  listCategories,
  listProducts,
  productionSnapshot,
  salesForDay,
  saveDailyProduction,
  saveProductionComment,
  stockSnapshot
} from "../modules/business.js";
import { seedDatabase } from "../db/idb.js";
import { todayISO } from "../utils/format.js";
import {
  filterProductButtons,
  renderCart,
  renderHistory,
  renderProductGrid,
  renderProduction,
  renderStockList,
  renderToGooSelect
} from "../ui/render.js";

const cart = new Map();
let products = [];
let categories = [];
let currentView = "caja";
let saleInProgress = false;
let toGooInProgress = false;
let productionInProgress = false;
let productionCommentInProgress = false;
let stockAdjustInProgress = false;
let cartOrder = 0;
let selectedProductionProductId = "";
let productionSheetOpen = false;
let selectedStockAdjustProductId = "";
let stockAdjustSheetOpen = false;
let shouldClearProductionCommentInput = false;


const dom = {
  appMessage: document.querySelector("#app-message"),
  navLinks: document.querySelectorAll(".nav-link"),
  views: document.querySelectorAll(".view"),
  productCategories: document.querySelector("#product-categories"),
  salesSearch: document.querySelector("#sales-search"),
  clearSalesSearch: document.querySelector("#clear-sales-search"),
  salesSearchEmpty: document.querySelector("#sales-search-empty"),
  cartItems: document.querySelector("#cart-items"),
  cartSandwichCount: document.querySelector("#cart-sandwich-count"),
  cartTotal: document.querySelector("#cart-total"),
  confirmSale: document.querySelector("#confirm-sale"),
  clearCart: document.querySelector("#clear-cart"),
  saleMessage: document.querySelector("#sale-message"),
  toGooForm: document.querySelector("#togoo-form"),
  toGooProduct: document.querySelector("#togoo-product"),
  toGooQuantity: document.querySelector("#togoo-quantity"),
  productionDateText: document.querySelector("#production-date-text"),
  productionCommentText: document.querySelector("#production-comment-text"),
  productionForm: document.querySelector("#production-form"),
  productionCommentForm: document.querySelector("#production-comment-form"),
  productionCommentInput: document.querySelector("#production-comment-input"),
  productionSheet: document.querySelector("#production-sheet"),
  productionSheetBackdrop: document.querySelector("#production-sheet-backdrop"),
  closeProductionSheet: document.querySelector("#close-production-sheet"),
  productionSelectedBox: document.querySelector("#production-selected-box"),
  productionQuantity: document.querySelector("#production-quantity"),
  productionSandwichesList: document.querySelector("#production-sandwiches-list"),
  productionBolleriaList: document.querySelector("#production-bolleria-list"),
  stockSearch: document.querySelector("#stock-search"),
  stockAdjustForm: document.querySelector("#stock-adjust-form"),
  stockAdjustSheet: document.querySelector("#stock-adjust-sheet"),
  stockAdjustBackdrop: document.querySelector("#stock-adjust-backdrop"),
  closeStockAdjust: document.querySelector("#close-stock-adjust"),
  stockAdjustSelectedBox: document.querySelector("#stock-adjust-selected-box"),
  stockAdjustQuantity: document.querySelector("#stock-adjust-quantity"),
  stockAdjustReason: document.querySelector("#stock-adjust-reason"),
  stockAdjustMinus: document.querySelector("#stock-adjust-minus"),
  stockAdjustPlus: document.querySelector("#stock-adjust-plus"),
  stockList: document.querySelector("#stock-list"),
  historyFilter: document.querySelector("#history-filter"),
  historyDate: document.querySelector("#history-date"),
  historyProductionText: document.querySelector("#history-production-text"),
  historyList: document.querySelector("#history-list"),
  exportSalesSummary: document.querySelector("#export-sales-summary")
};

function setFlash(text, type = "success") {
  dom.appMessage.textContent = text;
  dom.appMessage.className = `flash-message ${type}`;
  dom.appMessage.hidden = false;
  window.clearTimeout(setFlash.timeout);
  setFlash.timeout = window.setTimeout(() => {
    dom.appMessage.hidden = true;
  }, 4200);
}

function setSaleMessage(text, ok = false) {
  dom.saleMessage.textContent = text;
  dom.saleMessage.classList.toggle("ok-message", ok);
}

function setProductionSheetOpen(isOpen) {
  productionSheetOpen = isOpen;
  dom.productionSheet.classList.toggle("open", isOpen);
  dom.productionSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.productionSheetBackdrop.hidden = !isOpen;
  dom.productionSheetBackdrop.classList.toggle("open", isOpen);
}

function setStockAdjustSheetOpen(isOpen) {
  stockAdjustSheetOpen = isOpen;
  dom.stockAdjustSheet.classList.toggle("open", isOpen);
  dom.stockAdjustSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.stockAdjustBackdrop.hidden = !isOpen;
  dom.stockAdjustBackdrop.classList.toggle("open", isOpen);
}

function showView(viewName) {
  currentView = viewName;
  if (viewName !== "produccion") {
    setProductionSheetOpen(false);
  }
  if (viewName !== "stock") {
    setStockAdjustSheetOpen(false);
  }
  dom.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  dom.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
  window.location.hash = viewName;
  refreshView(viewName);
}

function quantityInCartForProduct(productId) {
  return Array.from(cart.values())
    .filter((item) => item.id === productId)
    .reduce((total, item) => total + item.quantity, 0);
}

function availableStockForProduct(product) {
  if (!product.controlaStock) return product.stockActual;
  return Math.max(0, product.stockActual - quantityInCartForProduct(product.id));
}

function productsWithReservedStock() {
  return products.map((product) => ({
    ...product,
    stockDisponible: availableStockForProduct(product)
  }));
}

function renderReservedStock() {
  const displayProducts = productsWithReservedStock();
  renderProductGrid(dom.productCategories, categories, displayProducts, addToCart);
  renderToGooSelect(dom.toGooProduct, displayProducts);
  filterProductButtons(dom.salesSearch, dom.salesSearchEmpty);
}

function addToCart(product, variant = { mode: "normal" }) {
  const mode = variant.mode || "normal";
  const cartKey = `${product.id}:${mode}`;
  const current = cart.get(cartKey);
  const nextQuantity = (current?.quantity || 0) + 1;
  if (product.controlaStock && quantityInCartForProduct(product.id) + 1 > product.stockActual) {
    setSaleMessage(`No queda mas stock de ${product.nombre}.`);
    return;
  }

  cart.set(cartKey, {
    ...product,
    cartKey,
    saleMode: mode,
    displayName: product.nombre,
    quantity: nextQuantity,
    unitOrders: [...(current?.unitOrders || []), cartOrder += 1]
  });
  setSaleMessage("");
  renderReservedStock();
  renderCurrentCart();
}

function changeQuantity(cartKey, delta) {
  const item = cart.get(cartKey);
  if (!item) return;

  const nextQuantity = item.quantity + delta;
  if (nextQuantity <= 0) {
    cart.delete(cartKey);
  } else if (!item.controlaStock || quantityInCartForProduct(item.id) + delta <= item.stockActual) {
    item.quantity = nextQuantity;
    if (delta > 0) {
      item.unitOrders = [...(item.unitOrders || []), cartOrder += 1];
    } else {
      item.unitOrders = (item.unitOrders || []).slice(0, nextQuantity);
    }
  } else {
    setSaleMessage(`Stock maximo: ${item.stockActual}.`);
  }
  renderReservedStock();
  renderCurrentCart();
}

function renderCurrentCart() {
  renderCart(
    dom.cartItems,
    dom.cartSandwichCount,
    dom.cartTotal,
    dom.confirmSale,
    cart,
    changeQuantity,
    calculateCartPricing(cart.values())
  );
}

async function loadProducts() {
  [categories, products] = await Promise.all([listCategories(), listProducts()]);
}

async function renderCashier() {
  await loadProducts();
  renderReservedStock();
  renderCurrentCart();
}

async function renderProductionView() {
  const snapshot = await productionSnapshot();
  if (selectedProductionProductId && !snapshot.productionProducts.some((product) => product.id === selectedProductionProductId)) {
    selectedProductionProductId = "";
  }
  const totalSandwichesProduced = snapshot.sandwiches.reduce(
    (total, product) => total + (Number(product.cantidadProducida) || 0),
    0
  );
  dom.productionDateText.textContent = `Fecha: ${snapshot.fecha}. Total cargado en sandwiches: ${totalSandwichesProduced}. Toca un producto en sandwiches o bolleria para sumar o restar stock.`;
  dom.productionCommentText.hidden = !snapshot.comentarios?.length;
  dom.productionCommentText.innerHTML = snapshot.comentarios?.length
    ? `
      <strong>Comentarios del dia</strong>
      <ol class="production-comment-list">
        ${snapshot.comentarios.map((comentario) => `<li>${comentario}</li>`).join("")}
      </ol>
    `
    : "";
  if (shouldClearProductionCommentInput) {
    dom.productionCommentInput.value = "";
    shouldClearProductionCommentInput = false;
  } else if (document.activeElement !== dom.productionCommentInput) {
    dom.productionCommentInput.value = "";
  }
  renderProduction(
    snapshot,
    dom.productionSelectedBox,
    selectedProductionProductId,
    selectProductionProduct,
    {
      sandwiches: dom.productionSandwichesList,
      bolleria: dom.productionBolleriaList
    }
  );
}

function selectProductionProduct(product) {
  selectedProductionProductId = product.id;
  setProductionSheetOpen(true);
  renderProductionView().then(() => {
    dom.productionQuantity.focus();
  });
}

function closeProductionSheet() {
  setProductionSheetOpen(false);
  selectedProductionProductId = "";
  dom.productionQuantity.value = "";
  renderProductionView();
}

function selectedStockAdjustProduct() {
  return products.find((product) => product.id === selectedStockAdjustProductId) || null;
}

function renderStockAdjustSelection() {
  const product = selectedStockAdjustProduct();
  if (!product) {
    dom.stockAdjustSelectedBox.innerHTML = "<strong>Selecciona un producto</strong><small>Stock actual: 0</small>";
    return;
  }
  dom.stockAdjustSelectedBox.innerHTML = "<strong></strong><small></small>";
  dom.stockAdjustSelectedBox.querySelector("strong").textContent = product.nombre;
  dom.stockAdjustSelectedBox.querySelector("small").textContent = `Stock actual: ${product.stockActual}`;
}

function openStockAdjustSheet(product) {
  selectedStockAdjustProductId = product.id;
  dom.stockAdjustQuantity.value = String(product.stockActual);
  dom.stockAdjustReason.value = "Recuento de stock";
  renderStockAdjustSelection();
  setStockAdjustSheetOpen(true);
  dom.stockAdjustQuantity.focus();
  dom.stockAdjustQuantity.select();
}

function closeStockAdjustSheet() {
  setStockAdjustSheetOpen(false);
  selectedStockAdjustProductId = "";
  dom.stockAdjustQuantity.value = "";
  dom.stockAdjustReason.value = "Recuento de stock";
}

function nudgeStockAdjust(delta) {
  const currentValue = Number(dom.stockAdjustQuantity.value || 0);
  const nextValue = Math.max(0, currentValue + delta);
  dom.stockAdjustQuantity.value = String(nextValue);
}

async function renderStockView() {
  products = await stockSnapshot();
  renderStockList(dom.stockList, products, dom.stockSearch.value, openStockAdjustSheet);
  if (stockAdjustSheetOpen) {
    const selectedProduct = selectedStockAdjustProduct();
    if (!selectedProduct) {
      closeStockAdjustSheet();
    } else {
      renderStockAdjustSelection();
    }
  }
}

async function renderHistoryView() {
  const fecha = dom.historyDate.value || todayISO();
  dom.historyDate.value = fecha;
  const snapshot = await productionSnapshot(fecha);
  const sales = await salesForDay(fecha);
  const totalSandwichesProduced = snapshot.sandwiches.reduce(
    (total, product) => total + (Number(product.cantidadProducida) || 0),
    0
  );
  const sandwichIds = new Set(snapshot.sandwiches.map((product) => product.id));
  const totalSandwichesSold = sales.reduce(
    (total, sale) => total + sale.detalles.reduce(
      (saleTotal, detail) => saleTotal + (sandwichIds.has(detail.productoId) ? Number(detail.cantidad) || 0 : 0),
      0
    ),
    0
  );
  const totalSandwichesDisponibles = snapshot.sandwiches.reduce(
    (total, product) => total + (Number(product.stockActual) || 0),
    0
  );
  const totalStockAyer = totalSandwichesDisponibles - totalSandwichesProduced + totalSandwichesSold;
  dom.historyProductionText.textContent = `De ayer: ${totalStockAyer} · Producidos hoy: ${totalSandwichesProduced} · Vendidos: ${totalSandwichesSold} · Quedan: ${totalSandwichesDisponibles}`;
  renderHistory(dom.historyList, sales);
}

async function refreshView(viewName = currentView) {
  if (viewName === "caja") await renderCashier();
  if (viewName === "produccion") await renderProductionView();
  if (viewName === "stock") await renderStockView();
  if (viewName === "historial") await renderHistoryView();
}

async function handleConfirmSale() {
  if (saleInProgress) return;
  try {
    saleInProgress = true;
    dom.confirmSale.disabled = true;
    setSaleMessage("Confirmando venta...");
    const items = Array.from(cart.values()).map((item) => ({
      productId: item.id,
      quantity: item.quantity,
      saleMode: item.saleMode,
      unitOrders: item.unitOrders
    }));
    const sale = await confirmSale(items);
    cart.clear();
    setSaleMessage(`Venta #${sale.saleId} confirmada.`, true);
    await renderCashier();
  } catch (error) {
    setSaleMessage(error.message || "No se pudo registrar la venta.");
    renderCurrentCart();
  } finally {
    saleInProgress = false;
  }
}

async function handleToGooSale(event) {
  event.preventDefault();
  if (toGooInProgress) return;
  try {
    toGooInProgress = true;
    const productId = dom.toGooProduct.value;
    const quantity = Number(dom.toGooQuantity.value);
    const product = products.find((item) => item.id === productId);
    if (!product) throw new Error("Selecciona un producto valido para ToGoo.");
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("La cantidad de ToGoo debe ser un entero mayor a 0.");
    if (product.controlaStock && availableStockForProduct(product) < quantity) {
      throw new Error(`Stock insuficiente: ${product.nombre}.`);
    }
    const sale = await confirmSale([{ productId, quantity, saleMode: "togoo" }]);
    dom.toGooQuantity.value = "1";
    setFlash(`Salida ToGoo registrada como venta #${sale.saleId}.`, "success");
    await renderCashier();
  } catch (error) {
    setFlash(error.message || "No se pudo registrar la salida ToGoo.", "error");
  } finally {
    toGooInProgress = false;
  }
}

function bindEvents() {
  dom.navLinks.forEach((link) => link.addEventListener("click", () => showView(link.dataset.view)));

  dom.salesSearch.addEventListener("input", () => filterProductButtons(dom.salesSearch, dom.salesSearchEmpty));
  dom.clearSalesSearch.addEventListener("click", () => {
    dom.salesSearch.value = "";
    filterProductButtons(dom.salesSearch, dom.salesSearchEmpty);
    dom.salesSearch.focus();
  });

  dom.clearCart.addEventListener("click", () => {
    cart.clear();
    setSaleMessage("");
    renderReservedStock();
    renderCurrentCart();
  });
  dom.confirmSale.addEventListener("click", handleConfirmSale);
  dom.toGooForm.addEventListener("submit", handleToGooSale);
  dom.closeProductionSheet.addEventListener("click", closeProductionSheet);
  dom.productionSheetBackdrop.addEventListener("click", closeProductionSheet);
  dom.closeStockAdjust.addEventListener("click", closeStockAdjustSheet);
  dom.stockAdjustBackdrop.addEventListener("click", closeStockAdjustSheet);
  dom.stockAdjustMinus.addEventListener("click", () => nudgeStockAdjust(-1));
  dom.stockAdjustPlus.addEventListener("click", () => nudgeStockAdjust(1));

  dom.productionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (productionInProgress) return;
    try {
      productionInProgress = true;
      if (!selectedProductionProductId) throw new Error("Selecciona un producto desde la lista.");
      await saveDailyProduction(selectedProductionProductId, dom.productionQuantity.value);
      dom.productionQuantity.value = "";
      setFlash("Produccion guardada.", "success");
      closeProductionSheet();
      await renderCashier();
    } catch (error) {
      setFlash(error.message, "error");
    } finally {
      productionInProgress = false;
    }
  });

  dom.productionCommentForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (productionCommentInProgress) return;
    try {
      productionCommentInProgress = true;
      await saveProductionComment(dom.productionCommentInput.value);
      shouldClearProductionCommentInput = true;
      setFlash("Comentario de produccion guardado.", "success");
      await renderProductionView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar el comentario.", "error");
    } finally {
      productionCommentInProgress = false;
    }
  });

  dom.stockSearch.addEventListener("input", renderStockView);
  dom.stockAdjustForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (stockAdjustInProgress) return;
    try {
      stockAdjustInProgress = true;
      const product = selectedStockAdjustProduct();
      if (!product) throw new Error("Selecciona un producto para ajustar.");
      const newStock = Number(dom.stockAdjustQuantity.value);
      if (!Number.isSafeInteger(newStock) || newStock < 0) {
        throw new Error("El nuevo stock debe ser un entero mayor o igual a 0.");
      }
      await adjustStockLevel(product.id, newStock, dom.stockAdjustReason.value);
      setFlash(`Stock de ${product.nombre} ajustado a ${newStock}.`, "success");
      closeStockAdjustSheet();
      await renderStockView();
      await renderCashier();
    } catch (error) {
      setFlash(error.message, "error");
    } finally {
      stockAdjustInProgress = false;
    }
  });
  dom.historyFilter.addEventListener("submit", (event) => {
    event.preventDefault();
    renderHistoryView();
  });

  dom.exportSalesSummary.addEventListener("click", async () => {
    await exportSalesSummary(dom.historyDate.value || todayISO());
    setFlash("Resumen TXT exportado.", "success");
  });

  window.addEventListener("hashchange", () => {
    const viewName = window.location.hash.replace("#", "") || "caja";
    if (["caja", "produccion", "stock", "historial"].includes(viewName)) showView(viewName);
  });
}

export async function startApp() {
  await seedDatabase();
  dom.historyDate.value = todayISO();
  bindEvents();
  const initialView = window.location.hash.replace("#", "") || "caja";
  showView(["caja", "produccion", "stock", "historial"].includes(initialView) ? initialView : "caja");
}
