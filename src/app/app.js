import { exportSalesSummary, exportDailySummaryJSON } from "../modules/backup.js";
import { signIn, signOut, restoreSession } from "../db/supabase.js";
import { seedInsumos, listInsumos, ajustarStockInsumo, calibrarInsumo, listaDeComprasSmart, exportarListaCompras, getCalibracionDashboardData, getRecetasDashboardData, actualizarReceta, saveInsumoCalibrationSettings, previewProduccionInsumos } from "../modules/aprovisionamiento.js";
import { seedProveedores, getProveedoresDashboardData, updateProveedor, saveProveedorInsumo } from "../modules/proveedores.js";
import { renderProveedoresList, renderProvProdInsumoSelect } from "../ui/render-proveedores.js";
import { trySyncVenta, trySyncMovimientosInsumos, trySyncInsumosSnapshot, trySyncRecetasSnapshot, setupAutoSync } from "../modules/sync.js";
import { renderInsumosList, renderInsumoAjusteSelected, renderCalibracionAlert, renderListaComprasSmart, renderCalibracionDashboard, renderCalibracionRecetaSettings, renderRecetasEditor } from "../ui/render-aprovisionamiento.js";
import { fetchPedidosDelDia, crearPedido, marcarPedidoListo, marcarPedidoEntregado } from "../modules/pedidos.js";
import { renderPedidosGrid, renderPedidoProductPicker } from "../ui/render-pedidos.js";
import { shareOrDownloadText } from "../utils/format.js";
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
  TOGOO_FLAT_TOTAL_CENTAVOS
} from "../modules/business.js";
import { seedDatabase, getAll } from "../db/idb.js";
import { todayISO } from "../utils/format.js";
import {
  filterProductButtons,
  renderCart,
  renderHistory,
  renderProductGrid,
  renderProduction
} from "../ui/render.js";

const cart = new Map();
let products = [];
let categories = [];
let currentView = "caja";
let saleInProgress = false;
let cartMode = "normal";
let productionInProgress = false;
let productionCommentInProgress = false;
let stockAdjustInProgress = false;
let cartOrder = 0;
let selectedProductionProductId = "";
let productionSheetOpen = false;
let insumoWarningSheetOpen = false;
let pendingProduction = null;
let selectedStockAdjustProductId = "";
let stockAdjustSheetOpen = false;
let shouldClearProductionCommentInput = false;
let insumosAjusteInProgress = false;
let insumosCalibracionInProgress = false;
let selectedInsumoId = "";
let selectedInsumo = null;
let insumosAjusteSheetOpen = false;
let insumosCalibracionSheetOpen = false;
let insumosAjusteTipo = "compra";
let insumosListaComprasVisible = false;
let recetaEditInProgress = false;
let selectedRecetaId = "";
let recetaEditSheetOpen = false;
let calibracionAlphaReceta = null;
let provEditInProgress = false;
let provProdInProgress = false;
let selectedProvId = "";
let selectedProvProdId = "";
let provProdMode = "add";
let provEditSheetOpen = false;
let provProdSheetOpen = false;
const pedidoCart = new Map();
let pedidoSheetOpen = false;
let pedidoCreateInProgress = false;
let pedidoActionInProgress = false;
let pedidosPollTimer = null;
let pedidoPrecioEditadoManualmente = false;
let currentGestionSubView = "insumos";


const dom = {
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  logoutButton: document.querySelector("#logout-button"),
  appMessage: document.querySelector("#app-message"),
  navLinks: document.querySelectorAll(".nav:not(.sub-nav) > .nav-link"),
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
  cartModeTogooToggle: document.querySelector("#cart-mode-togoo"),
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
  insumoWarningSheet: document.querySelector("#insumo-warning-sheet"),
  insumoWarningBackdrop: document.querySelector("#insumo-warning-backdrop"),
  closeInsumoWarning: document.querySelector("#close-insumo-warning"),
  insumoWarningText: document.querySelector("#insumo-warning-text"),
  insumoWarningUpdate: document.querySelector("#insumo-warning-update"),
  insumoWarningContinue: document.querySelector("#insumo-warning-continue"),
  stockAdjustForm: document.querySelector("#stock-adjust-form"),
  stockAdjustSheet: document.querySelector("#stock-adjust-sheet"),
  stockAdjustBackdrop: document.querySelector("#stock-adjust-backdrop"),
  closeStockAdjust: document.querySelector("#close-stock-adjust"),
  stockAdjustSelectedBox: document.querySelector("#stock-adjust-selected-box"),
  stockAdjustQuantity: document.querySelector("#stock-adjust-quantity"),
  stockAdjustReason: document.querySelector("#stock-adjust-reason"),
  stockAdjustMinus: document.querySelector("#stock-adjust-minus"),
  stockAdjustPlus: document.querySelector("#stock-adjust-plus"),
  historyFilter: document.querySelector("#history-filter"),
  historyDate: document.querySelector("#history-date"),
  historyProductionText: document.querySelector("#history-production-text"),
  historyList: document.querySelector("#history-list"),
  exportSalesSummary: document.querySelector("#export-sales-summary"),
  exportSalesJson: document.querySelector("#export-sales-json"),
  insumosList: document.querySelector("#insumos-list"),
  calibracionAlert: document.querySelector("#calibracion-alert"),
  insumosAjusteSheet: document.querySelector("#insumos-ajuste-sheet"),
  insumosAjusteBackdrop: document.querySelector("#insumos-ajuste-backdrop"),
  closeInsumosAjuste: document.querySelector("#close-insumos-ajuste"),
  insumosAjusteForm: document.querySelector("#insumos-ajuste-form"),
  insumosAjusteSelected: document.querySelector("#insumos-ajuste-selected"),
  insumosCompraCantidad: document.querySelector("#insumos-compra-cantidad"),
  insumosCompraCampo: document.querySelector("#insumos-compra-field"),
  insumosCompraLabel: document.querySelector("#insumos-compra-label"),
  insumosAjusteCantidad: document.querySelector("#insumos-ajuste-cantidad"),
  insumosAjusteCampo: document.querySelector("#insumos-ajuste-field"),
  insumosAjusteMinus: document.querySelector("#insumos-ajuste-minus"),
  insumosAjustePlus: document.querySelector("#insumos-ajuste-plus"),
  insumosAjusteUnidad: document.querySelector("#insumos-ajuste-unidad"),
  insumosAjusteDeltaHint: document.querySelector("#insumos-ajuste-delta-hint"),
  insumosAjusteMotivos: document.querySelector("#insumos-ajuste-motivos"),
  insumosAjusteTipoCompra: document.querySelector("#insumo-tipo-compra"),
  insumosAjusteTipoAjuste: document.querySelector("#insumo-tipo-ajuste"),
  calibracionSheet: document.querySelector("#calibracion-sheet"),
  calibracionBackdrop: document.querySelector("#calibracion-backdrop"),
  closeCalibracion: document.querySelector("#close-calibracion"),
  calibracionForm: document.querySelector("#calibracion-form"),
  calibracionSelected: document.querySelector("#calibracion-selected"),
  calibracionCantidad: document.querySelector("#calibracion-cantidad"),
  calibracionLabel: document.querySelector("#calibracion-label"),
  calibrarList: document.querySelector("#calibrar-list"),
  calibracionRecetaSettings: document.querySelector("#calibracion-receta-settings"),
  recetasList: document.querySelector("#recetas-list"),
  recetaEditSheet: document.querySelector("#receta-edit-sheet"),
  recetaEditBackdrop: document.querySelector("#receta-edit-backdrop"),
  closeRecetaEdit: document.querySelector("#close-receta-edit"),
  recetaEditForm: document.querySelector("#receta-edit-form"),
  recetaEditTitle: document.querySelector("#receta-edit-title"),
  recetaEditContext: document.querySelector("#receta-edit-context"),
  recetaEditLabel: document.querySelector("#receta-edit-label"),
  recetaEditCantidad: document.querySelector("#receta-edit-cantidad"),
  recetaEditMotivo: document.querySelector("#receta-edit-motivo"),
  verListaCompras: document.querySelector("#ver-lista-compras"),
  listaComprasSection: document.querySelector("#lista-compras-section"),
  listaComprasList: document.querySelector("#lista-compras-list"),
  exportListaCompras: document.querySelector("#export-lista-compras"),
  proveedoresList: document.querySelector("#proveedores-list"),
  provEditSheet: document.querySelector("#prov-edit-sheet"),
  provEditBackdrop: document.querySelector("#prov-edit-backdrop"),
  closeProvEdit: document.querySelector("#close-prov-edit"),
  provEditForm: document.querySelector("#prov-edit-form"),
  provEditNombre: document.querySelector("#prov-edit-nombre"),
  provEditTel: document.querySelector("#prov-edit-tel"),
  provEditEmail: document.querySelector("#prov-edit-email"),
  provEditNotas: document.querySelector("#prov-edit-notas"),
  provEditDias: document.querySelector("#prov-edit-dias"),
  provProdSheet: document.querySelector("#prov-prod-sheet"),
  provProdBackdrop: document.querySelector("#prov-prod-backdrop"),
  closeProvProd: document.querySelector("#close-prov-prod"),
  provProdForm: document.querySelector("#prov-prod-form"),
  provProdTitle: document.querySelector("#prov-prod-title"),
  provProdContext: document.querySelector("#prov-prod-context"),
  provProdNombre: document.querySelector("#prov-prod-nombre"),
  provProdUnidad: document.querySelector("#prov-prod-unidad"),
  provProdInsumo: document.querySelector("#prov-prod-insumo"),
  provProdCantidadLabel: document.querySelector("#prov-prod-cantidad-label"),
  provProdCantidad: document.querySelector("#prov-prod-cantidad"),
  provProdPrecio: document.querySelector("#prov-prod-precio"),
  pedidosGrid: document.querySelector("#pedidos-grid"),
  openNuevoPedido: document.querySelector("#open-nuevo-pedido"),
  pedidoSheet: document.querySelector("#pedido-sheet"),
  pedidoSheetBackdrop: document.querySelector("#pedido-sheet-backdrop"),
  closePedidoSheet: document.querySelector("#close-pedido-sheet"),
  pedidoForm: document.querySelector("#pedido-form"),
  pedidoProductPicker: document.querySelector("#pedido-product-picker"),
  pedidoCartItems: document.querySelector("#pedido-cart-items"),
  pedidoCartTotal: document.querySelector("#pedido-cart-total"),
  pedidoClienteNombre: document.querySelector("#pedido-cliente-nombre"),
  pedidoFechaHora: document.querySelector("#pedido-fecha-hora"),
  pedidoPrecioTotal: document.querySelector("#pedido-precio-total"),
  pedidoPagado: document.querySelector("#pedido-pagado"),
  pedidoCortadoMitad: document.querySelector("#pedido-cortado-mitad"),
  pedidoAclaraciones: document.querySelector("#pedido-aclaraciones"),
  confirmPedido: document.querySelector("#confirm-pedido")
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

function setInsumoWarningSheetOpen(isOpen) {
  insumoWarningSheetOpen = isOpen;
  dom.insumoWarningSheet.classList.toggle("open", isOpen);
  dom.insumoWarningSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.insumoWarningBackdrop.hidden = !isOpen;
  dom.insumoWarningBackdrop.classList.toggle("open", isOpen);
}

function closeInsumoWarningSheet() {
  setInsumoWarningSheetOpen(false);
  pendingProduction = null;
}

function setInsumosAjusteSheetOpen(isOpen) {
  insumosAjusteSheetOpen = isOpen;
  dom.insumosAjusteSheet.classList.toggle("open", isOpen);
  dom.insumosAjusteSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.insumosAjusteBackdrop.hidden = !isOpen;
  dom.insumosAjusteBackdrop.classList.toggle("open", isOpen);
}

function setInsumosCalibracionSheetOpen(isOpen) {
  insumosCalibracionSheetOpen = isOpen;
  dom.calibracionSheet.classList.toggle("open", isOpen);
  dom.calibracionSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.calibracionBackdrop.hidden = !isOpen;
  dom.calibracionBackdrop.classList.toggle("open", isOpen);
}

function setRecetaEditSheetOpen(isOpen) {
  recetaEditSheetOpen = isOpen;
  dom.recetaEditSheet.classList.toggle("open", isOpen);
  dom.recetaEditSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.recetaEditBackdrop.hidden = !isOpen;
  dom.recetaEditBackdrop.classList.toggle("open", isOpen);
}

function setStockAdjustSheetOpen(isOpen) {
  stockAdjustSheetOpen = isOpen;
  dom.stockAdjustSheet.classList.toggle("open", isOpen);
  dom.stockAdjustSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.stockAdjustBackdrop.hidden = !isOpen;
  dom.stockAdjustBackdrop.classList.toggle("open", isOpen);
}

function setPedidoSheetOpen(isOpen) {
  pedidoSheetOpen = isOpen;
  dom.pedidoSheet.classList.toggle("open", isOpen);
  dom.pedidoSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.pedidoSheetBackdrop.hidden = !isOpen;
  dom.pedidoSheetBackdrop.classList.toggle("open", isOpen);
}

function stopPedidosPolling() {
  if (pedidosPollTimer) {
    window.clearInterval(pedidosPollTimer);
    pedidosPollTimer = null;
  }
}

function startPedidosPolling() {
  stopPedidosPolling();
  pedidosPollTimer = window.setInterval(() => { renderPedidosView(); }, 9000);
}

function closeAllGestionSheets() {
  setInsumosAjusteSheetOpen(false);
  setInsumosCalibracionSheetOpen(false);
  setRecetaEditSheetOpen(false);
  setProvEditSheetOpen(false);
  setProvProdSheetOpen(false);
}

async function refreshGestionSubView(subViewName) {
  if (subViewName === "insumos") await renderInsumosView();
  if (subViewName === "calibrar") await renderCalibracionView();
  if (subViewName === "recetas") await renderRecetasView();
  if (subViewName === "proveedores") await renderProveedoresView();
}

function showGestionSubView(subViewName) {
  closeAllGestionSheets();
  currentGestionSubView = subViewName;
  document.querySelectorAll(".subview").forEach((section) => section.classList.toggle("active", section.id === `subview-${subViewName}`));
  document.querySelectorAll(".sub-nav-link").forEach((link) => link.classList.toggle("active", link.dataset.subview === subViewName));
  refreshGestionSubView(subViewName);
}

function showView(viewName) {
  currentView = viewName;
  if (viewName !== "produccion") {
    setProductionSheetOpen(false);
    setStockAdjustSheetOpen(false);
    closeInsumoWarningSheet();
  }
  if (viewName !== "gestion") {
    closeAllGestionSheets();
  }
  if (viewName !== "pedidos") {
    setPedidoSheetOpen(false);
    stopPedidosPolling();
  }
  dom.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  dom.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
  window.location.hash = viewName;
  refreshView(viewName);
  if (viewName === "pedidos") startPedidosPolling();
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
  filterProductButtons(dom.salesSearch, dom.salesSearchEmpty);
}

function setCartMode(mode) {
  if (mode === cartMode) return;
  if (cart.size > 0) {
    cart.clear();
    setFlash("Carrito vaciado al cambiar de modo.", "success");
  }
  cartMode = mode;
  dom.cartModeTogooToggle.checked = mode === "togoo";
  renderReservedStock();
  renderCurrentCart();
}

function addToCart(product) {
  const mode = cartMode;
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

function effectiveSaleMode(item) {
  // Mismo criterio que confirmSale en business.js: togoo/baja solo aplican a productos
  // con control de stock propio — un producto sin stock (ej. cafe) agregado con el
  // carrito en modo ToGoo termina cobrando precio normal igual.
  if (item.saleMode === "togoo" && item.controlaStock) return "togoo";
  if (item.saleMode === "baja" && item.controlaStock) return "baja";
  return "normal";
}

function renderCurrentCart() {
  const items = Array.from(cart.values());
  const pricing = calculateCartPricing(items.filter((item) => effectiveSaleMode(item) === "normal"));
  const hasTogoo = items.some((item) => effectiveSaleMode(item) === "togoo");
  renderCart(
    dom.cartItems,
    dom.cartSandwichCount,
    dom.cartTotal,
    dom.confirmSale,
    cart,
    changeQuantity,
    { ...pricing, totalCentavos: pricing.totalCentavos + (hasTogoo ? TOGOO_FLAT_TOTAL_CENTAVOS : 0) }
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
  await loadProducts();
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
    },
    openStockAdjustSheet
  );
  if (stockAdjustSheetOpen) {
    const selectedProduct = selectedStockAdjustProduct();
    if (!selectedProduct) {
      closeStockAdjustSheet();
    } else {
      renderStockAdjustSelection();
    }
  }
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

function setInsumosAjusteTipo(tipo) {
  insumosAjusteTipo = tipo;
  const isCompra = tipo === "compra";
  dom.insumosCompraCampo.hidden = !isCompra;
  dom.insumosAjusteCampo.hidden = isCompra;
  dom.insumosAjusteTipoCompra.classList.toggle("active", isCompra);
  dom.insumosAjusteTipoAjuste.classList.toggle("active", !isCompra);
}

function getInsumoStep(insumo) {
  if (insumo.unidad === "g" || insumo.unidad === "ml") return 100;
  if (insumo.unidad === "L" || insumo.unidad === "kg") return 0.1;
  return 1;
}

function updateAjusteDeltaHint(insumo) {
  const nuevo = parseFloat(dom.insumosAjusteCantidad.value);
  const hint = dom.insumosAjusteDeltaHint;
  if (!insumo || isNaN(nuevo)) { hint.textContent = ""; hint.className = "insumo-stepper-hint"; return; }
  const delta = parseFloat((nuevo - insumo.stockActual).toFixed(4));
  if (delta === 0) {
    hint.textContent = "Sin cambios respecto al stock actual";
    hint.className = "insumo-stepper-hint";
  } else if (delta > 0) {
    hint.textContent = `+${delta} ${insumo.unidad} respecto al stock actual`;
    hint.className = "insumo-stepper-hint sube";
  } else {
    hint.textContent = `${delta} ${insumo.unidad} respecto al stock actual`;
    hint.className = "insumo-stepper-hint baja";
  }
}

function openInsumoAjusteSheet(insumo) {
  selectedInsumoId = insumo.id;
  selectedInsumo = insumo;
  renderInsumoAjusteSelected(dom.insumosAjusteSelected, insumo);
  setInsumosAjusteTipo("compra");
  dom.insumosCompraLabel.textContent = `Cantidad recibida (${insumo.unidadCompra})`;
  dom.insumosCompraCantidad.value = "";
  const stockVal = Number.isInteger(insumo.stockActual) ? insumo.stockActual : parseFloat(insumo.stockActual.toFixed(1));
  dom.insumosAjusteCantidad.value = String(stockVal);
  dom.insumosAjusteUnidad.textContent = insumo.unidad;
  dom.insumosAjusteMotivos.querySelectorAll("input[type='radio']").forEach(r => { r.checked = false; });
  updateAjusteDeltaHint(insumo);
  setInsumosAjusteSheetOpen(true);
  dom.insumosCompraCantidad.focus();
}

function closeInsumoAjusteSheet() {
  setInsumosAjusteSheetOpen(false);
  selectedInsumoId = "";
  selectedInsumo = null;
  dom.insumosCompraCantidad.value = "";
  dom.insumosAjusteCantidad.value = "";
  dom.insumosAjusteMotivos.querySelectorAll("input[type='radio']").forEach(r => { r.checked = false; });
  dom.insumosAjusteDeltaHint.textContent = "";
  dom.insumosAjusteDeltaHint.className = "insumo-stepper-hint";
}

function openCalibracionSheet(insumo) {
  selectedInsumoId = insumo.id;
  const stockDisplay = insumo.unidad === "g"
    ? `${insumo.stockActual}g`
    : `${Number.isInteger(insumo.stockActual) ? insumo.stockActual : insumo.stockActual.toFixed(1)} ${insumo.unidad}`;
  dom.calibracionSelected.innerHTML = `
    <strong>${insumo.nombre}</strong>
    <small>Sistema calcula: ${stockDisplay} (${(insumo.stockActual / insumo.factorConversion).toFixed(2)} ${insumo.unidadCompra})</small>
  `;
  dom.calibracionLabel.textContent = `Stock real que contas (${insumo.unidad})`;
  dom.calibracionCantidad.value = "";
  calibracionAlphaReceta = insumo.alphaReceta ?? 0.80;
  renderCalibracionRecetaSettings(dom.calibracionRecetaSettings, insumo, (_id, newSettings) => {
    calibracionAlphaReceta = newSettings.alphaReceta;
  });
  setInsumosCalibracionSheetOpen(true);
  dom.calibracionCantidad.focus();
}

function closeCalibracionSheet() {
  setInsumosCalibracionSheetOpen(false);
  selectedInsumoId = "";
  calibracionAlphaReceta = null;
  dom.calibracionCantidad.value = "";
}

async function renderInsumosView() {
  const insumos = await listInsumos();
  renderInsumosList(dom.insumosList, insumos, openInsumoAjusteSheet);
  renderCalibracionAlert(dom.calibracionAlert, insumos);
  if (insumosListaComprasVisible) {
    const smartData = await listaDeComprasSmart();
    renderListaComprasSmart(dom.listaComprasList, smartData);
  }
}

async function renderCalibracionView() {
  const data = await getCalibracionDashboardData();
  renderCalibracionDashboard(dom.calibrarList, data, openCalibracionSheet, async (insumoId, newSettings) => {
    await saveInsumoCalibrationSettings(insumoId, newSettings);
    await renderCalibracionView();
  });
}

function openRecetaEditSheet(receta) {
  selectedRecetaId = receta.id;
  dom.recetaEditTitle.textContent = receta.insumoNombre;
  dom.recetaEditContext.textContent = `Cantidad actual: ${receta.cantidadPorUnidad} ${receta.unidad} por unidad${receta.esEstimado ? " (estimado)" : ""}`;
  dom.recetaEditLabel.textContent = `Nueva cantidad (${receta.unidad} por unidad)`;
  dom.recetaEditCantidad.value = String(receta.cantidadPorUnidad);
  setRecetaEditSheetOpen(true);
  dom.recetaEditCantidad.focus();
  dom.recetaEditCantidad.select();
}

function closeRecetaEditSheet() {
  setRecetaEditSheetOpen(false);
  selectedRecetaId = "";
  dom.recetaEditCantidad.value = "";
  dom.recetaEditMotivo.value = "";
}

async function renderRecetasView() {
  const data = await getRecetasDashboardData();
  renderRecetasEditor(dom.recetasList, data, openRecetaEditSheet);
}

function setProvEditSheetOpen(isOpen) {
  provEditSheetOpen = isOpen;
  dom.provEditSheet.classList.toggle("open", isOpen);
  dom.provEditSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.provEditBackdrop.hidden = !isOpen;
  dom.provEditBackdrop.classList.toggle("open", isOpen);
}

function setProvProdSheetOpen(isOpen) {
  provProdSheetOpen = isOpen;
  dom.provProdSheet.classList.toggle("open", isOpen);
  dom.provProdSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.provProdBackdrop.hidden = !isOpen;
  dom.provProdBackdrop.classList.toggle("open", isOpen);
}

function openProvEdit(proveedor) {
  selectedProvId = proveedor.id;
  dom.provEditNombre.value = proveedor.nombre;
  dom.provEditTel.value = proveedor.tel ?? "";
  dom.provEditEmail.value = proveedor.email ?? "";
  dom.provEditNotas.value = proveedor.notas ?? "";
  dom.provEditDias.value = String(proveedor.diasCiclo ?? "");
  setProvEditSheetOpen(true);
  dom.provEditNombre.focus();
}

function closeProvEdit() {
  setProvEditSheetOpen(false);
  selectedProvId = "";
}

async function openProvProdAdd(proveedorId) {
  selectedProvId = proveedorId;
  selectedProvProdId = "";
  provProdMode = "add";
  dom.provProdTitle.textContent = "Agregar producto";
  dom.provProdContext.textContent = "";
  dom.provProdNombre.value = "";
  dom.provProdUnidad.value = "";
  dom.provProdCantidad.value = "";
  dom.provProdPrecio.value = "";
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, "");
  updateProvProdCantidadLabel();
  setProvProdSheetOpen(true);
  dom.provProdNombre.focus();
}

async function openProvProdEdit(producto) {
  selectedProvId = producto.proveedorId;
  selectedProvProdId = producto.id;
  provProdMode = "edit";
  dom.provProdTitle.textContent = "Editar producto";
  dom.provProdContext.textContent = producto.nombreProducto;
  dom.provProdNombre.value = producto.nombreProducto;
  dom.provProdUnidad.value = producto.unidadCompra ?? "";
  dom.provProdCantidad.value = String(producto.cantidadPorUnidad ?? "");
  dom.provProdPrecio.value = String((producto.precioUnitarioCentavos / 100).toFixed(2));
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, producto.insumoId ?? "");
  updateProvProdCantidadLabel();
  setProvProdSheetOpen(true);
  dom.provProdNombre.focus();
}

function closeProvProd() {
  setProvProdSheetOpen(false);
  selectedProvId = "";
  selectedProvProdId = "";
}

function updateProvProdCantidadLabel() {
  const insumoId = dom.provProdInsumo.value;
  if (!insumoId) {
    dom.provProdCantidadLabel.textContent = "Cantidad por unidad de compra (unidades)";
    return;
  }
  const option = dom.provProdInsumo.options[dom.provProdInsumo.selectedIndex];
  const labelText = option?.text ?? "";
  const match = labelText.match(/\(([^)]+)\)$/);
  const unidad = match ? match[1] : "";
  dom.provProdCantidadLabel.textContent = unidad
    ? `Cantidad en ${unidad} por unidad de compra`
    : "Cantidad por unidad de compra";
}

async function renderProveedoresView() {
  const data = await getProveedoresDashboardData();
  renderProveedoresList(dom.proveedoresList, data, {
    onEditProv: openProvEdit,
    onAddProd: openProvProdAdd,
    onEditProd: openProvProdEdit
  });
}

async function refreshView(viewName = currentView) {
  if (viewName === "caja") await renderCashier();
  if (viewName === "pedidos") await renderPedidosView();
  if (viewName === "produccion") await renderProductionView();
  if (viewName === "historial") await renderHistoryView();
  if (viewName === "gestion") await refreshGestionSubView(currentGestionSubView);
}

async function renderPedidosView() {
  try {
    await loadProducts();
    const pedidos = await fetchPedidosDelDia();
    renderPedidosGrid(dom.pedidosGrid, pedidos, {
      onMarcarListo: handleMarcarListo,
      onMarcarEntregado: handleMarcarEntregado
    });
  } catch (error) {
    dom.pedidosGrid.textContent = "No se pudo cargar los pedidos (revisa la conexion).";
    dom.pedidosGrid.classList.add("empty");
  }
}

function sandwichProductsForPedido() {
  // categoriaId "sandwiches" tambien incluye promos de combo (ej. "Promo bebida") que no son
  // sabores reales — esas no controlan stock, asi que se excluyen con controlaStock.
  return products.filter((p) => p.activo && p.categoriaId === "sandwiches" && p.controlaStock);
}

function pedidoCartTotalCentavos() {
  let total = 0;
  for (const item of pedidoCart.values()) total += item.precioUnitarioCentavos * item.cantidad;
  return total;
}

function renderPedidoSheetContents() {
  renderPedidoProductPicker(dom.pedidoProductPicker, sandwichProductsForPedido(), pedidoCart, addToPedidoCart, decrementPedidoCartItem);
  dom.confirmPedido.disabled = pedidoCart.size === 0;
  if (!pedidoPrecioEditadoManualmente) {
    dom.pedidoPrecioTotal.value = (pedidoCartTotalCentavos() / 100).toFixed(2);
  }
}

function addToPedidoCart(product) {
  const existing = pedidoCart.get(product.id);
  pedidoCart.set(product.id, {
    productId: product.id,
    nombre: product.nombre,
    cantidad: (existing?.cantidad || 0) + 1,
    precioUnitarioCentavos: product.precioCentavos
  });
  renderPedidoSheetContents();
}

function changePedidoCartQuantity(productId, delta) {
  const item = pedidoCart.get(productId);
  if (!item) return;
  item.cantidad += delta;
  if (item.cantidad <= 0) pedidoCart.delete(productId);
  renderPedidoSheetContents();
}

function decrementPedidoCartItem(productId) {
  changePedidoCartQuantity(productId, -1);
}

function openNuevoPedidoSheet() {
  pedidoCart.clear();
  pedidoPrecioEditadoManualmente = false;
  dom.pedidoClienteNombre.value = "";
  dom.pedidoFechaHora.value = "";
  dom.pedidoPrecioTotal.value = "";
  dom.pedidoPagado.checked = false;
  dom.pedidoCortadoMitad.checked = false;
  dom.pedidoAclaraciones.value = "";
  renderPedidoSheetContents();
  setPedidoSheetOpen(true);
}

function closePedidoSheet() {
  setPedidoSheetOpen(false);
}

async function handleCrearPedido(event) {
  event.preventDefault();
  if (pedidoCreateInProgress) return;
  try {
    pedidoCreateInProgress = true;
    if (pedidoCart.size === 0) throw new Error("Agrega al menos un producto al pedido.");
    if (!dom.pedidoFechaHora.value) throw new Error("Falta la fecha y hora de retiro.");
    const totalCentavos = Math.round(parseFloat(dom.pedidoPrecioTotal.value) * 100);
    await crearPedido({
      clienteNombre: dom.pedidoClienteNombre.value,
      fechaHoraRetiro: new Date(dom.pedidoFechaHora.value).toISOString(),
      pagado: dom.pedidoPagado.checked,
      cortadoMitad: dom.pedidoCortadoMitad.checked,
      aclaraciones: dom.pedidoAclaraciones.value,
      totalCentavos,
      items: Array.from(pedidoCart.values())
    });
    setFlash("Pedido creado.", "success");
    closePedidoSheet();
    await renderPedidosView();
  } catch (error) {
    setFlash(error.message || "No se pudo crear el pedido.", "error");
  } finally {
    pedidoCreateInProgress = false;
  }
}

async function handleMarcarListo(pedido) {
  if (pedidoActionInProgress) return;
  try {
    pedidoActionInProgress = true;
    const result = await marcarPedidoListo(pedido);
    setFlash(`Pedido de ${pedido.clienteNombre} preparado. Stock descontado.`, "success");
    // Sync fire-and-forget — nunca bloquea el flujo de pedidos
    const { venta, detalles, movimientosStock } = result._syncPayload;
    trySyncVenta({ venta, detalles, movimientosStock }).catch(() => {});
  } catch (error) {
    setFlash(error.message || "No se pudo marcar el pedido como listo.", "error");
  } finally {
    pedidoActionInProgress = false;
    await renderPedidosView();
  }
}

async function handleMarcarEntregado(pedido) {
  if (pedidoActionInProgress) return;
  try {
    pedidoActionInProgress = true;
    await marcarPedidoEntregado(pedido.id);
    setFlash(`Pedido de ${pedido.clienteNombre} entregado.`, "success");
  } catch (error) {
    setFlash(error.message || "No se pudo marcar el pedido como entregado.", "error");
  } finally {
    pedidoActionInProgress = false;
    await renderPedidosView();
  }
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
    setSaleMessage(
      sale.saleMode === "togoo" ? `Venta ToGoo #${sale.saleId} confirmada.` : `Venta #${sale.saleId} confirmada.`,
      true
    );
    setCartMode("normal");
    // Sync fire-and-forget — nunca bloquea la caja
    const { venta, detalles, movimientosStock, movimientosInsumos } = sale._syncPayload;
    trySyncVenta({ venta, detalles, movimientosStock }).catch(() => {});
    if (movimientosInsumos.length > 0) trySyncMovimientosInsumos(movimientosInsumos).catch(() => {});
    await renderCashier();
  } catch (error) {
    setSaleMessage(error.message || "No se pudo registrar la venta.");
    renderCurrentCart();
  } finally {
    saleInProgress = false;
  }
}

async function commitProduction(productId, quantityRaw) {
  const { warnings } = await saveDailyProduction(productId, quantityRaw);
  dom.productionQuantity.value = "";
  if (warnings.length > 0) {
    setFlash(`Produccion guardada. ${warnings.join(" ")}`, "warning");
  } else {
    setFlash("Produccion guardada.", "success");
  }
  closeProductionSheet();
  await renderCashier();
}

function bindEvents() {
  dom.navLinks.forEach((link) => link.addEventListener("click", () => showView(link.dataset.view)));
  document.querySelectorAll(".sub-nav-link").forEach((link) => link.addEventListener("click", () => showGestionSubView(link.dataset.subview)));

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
  dom.cartModeTogooToggle.addEventListener("change", () => {
    setCartMode(dom.cartModeTogooToggle.checked ? "togoo" : "normal");
  });
  dom.closeProductionSheet.addEventListener("click", closeProductionSheet);
  dom.productionSheetBackdrop.addEventListener("click", closeProductionSheet);
  dom.openNuevoPedido.addEventListener("click", openNuevoPedidoSheet);
  dom.closePedidoSheet.addEventListener("click", closePedidoSheet);
  dom.pedidoSheetBackdrop.addEventListener("click", closePedidoSheet);
  dom.pedidoForm.addEventListener("submit", handleCrearPedido);
  dom.pedidoPrecioTotal.addEventListener("input", () => {
    pedidoPrecioEditadoManualmente = true;
  });
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
      const quantityRaw = dom.productionQuantity.value;
      const cantidad = Number(quantityRaw);
      if (Number.isFinite(cantidad) && cantidad > 0) {
        const faltantes = await previewProduccionInsumos(selectedProductionProductId, cantidad);
        if (faltantes.length > 0) {
          pendingProduction = { productId: selectedProductionProductId, quantityRaw, faltantes };
          dom.insumoWarningText.textContent = faltantes
            .map((f) => `${f.nombre}: quedaria en ${f.stockResultante}${f.unidad}.`)
            .join(" ");
          setInsumoWarningSheetOpen(true);
          return;
        }
      }
      await commitProduction(selectedProductionProductId, quantityRaw);
    } catch (error) {
      setFlash(error.message, "error");
    } finally {
      productionInProgress = false;
    }
  });

  dom.insumoWarningContinue.addEventListener("click", async () => {
    if (!pendingProduction || productionInProgress) return;
    const { productId, quantityRaw } = pendingProduction;
    closeInsumoWarningSheet();
    try {
      productionInProgress = true;
      await commitProduction(productId, quantityRaw);
    } catch (error) {
      setFlash(error.message, "error");
    } finally {
      productionInProgress = false;
    }
  });

  dom.insumoWarningUpdate.addEventListener("click", async () => {
    const pending = pendingProduction;
    closeInsumoWarningSheet();
    closeProductionSheet();
    showView("gestion");
    showGestionSubView("insumos");
    if (pending && pending.faltantes.length > 0) {
      const insumos = await listInsumos();
      const insumo = insumos.find((i) => i.id === pending.faltantes[0].insumoId);
      if (insumo) openInsumoAjusteSheet(insumo);
    }
  });

  dom.closeInsumoWarning.addEventListener("click", closeInsumoWarningSheet);
  dom.insumoWarningBackdrop.addEventListener("click", closeInsumoWarningSheet);

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
      const { warnings } = await adjustStockLevel(product.id, newStock, dom.stockAdjustReason.value);
      if (warnings.length > 0) {
        setFlash(`Stock de ${product.nombre} ajustado a ${newStock}. ${warnings.join(" ")}`, "warning");
      } else {
        setFlash(`Stock de ${product.nombre} ajustado a ${newStock}.`, "success");
      }
      closeStockAdjustSheet();
      await renderProductionView();
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

  dom.exportSalesJson.addEventListener("click", async () => {
    await exportDailySummaryJSON(dom.historyDate.value || todayISO());
    setFlash("Resumen JSON exportado.", "success");
  });

  dom.closeInsumosAjuste.addEventListener("click", closeInsumoAjusteSheet);
  dom.insumosAjusteBackdrop.addEventListener("click", closeInsumoAjusteSheet);
  dom.closeCalibracion.addEventListener("click", closeCalibracionSheet);
  dom.calibracionBackdrop.addEventListener("click", closeCalibracionSheet);

  dom.insumosAjusteTipoCompra.addEventListener("click", () => setInsumosAjusteTipo("compra"));
  dom.insumosAjusteTipoAjuste.addEventListener("click", () => setInsumosAjusteTipo("ajuste"));

  dom.insumosAjusteMinus.addEventListener("click", () => {
    if (!selectedInsumo) return;
    const paso = getInsumoStep(selectedInsumo);
    const cur = parseFloat(dom.insumosAjusteCantidad.value) || 0;
    dom.insumosAjusteCantidad.value = String(parseFloat(Math.max(0, cur - paso).toFixed(4)));
    updateAjusteDeltaHint(selectedInsumo);
  });

  dom.insumosAjustePlus.addEventListener("click", () => {
    if (!selectedInsumo) return;
    const paso = getInsumoStep(selectedInsumo);
    const cur = parseFloat(dom.insumosAjusteCantidad.value) || 0;
    dom.insumosAjusteCantidad.value = String(parseFloat((cur + paso).toFixed(4)));
    updateAjusteDeltaHint(selectedInsumo);
  });

  dom.insumosAjusteCantidad.addEventListener("input", () => updateAjusteDeltaHint(selectedInsumo));

  dom.calibracionAlert.addEventListener("click", async (e) => {
    const insumos = await listInsumos();
    const pendiente = insumos.find(i => i.necesitaCalibracion);
    if (pendiente) openCalibracionSheet(pendiente);
  });

  dom.insumosAjusteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (insumosAjusteInProgress || !selectedInsumoId) return;
    try {
      insumosAjusteInProgress = true;
      const insumos = await listInsumos();
      const insumo = insumos.find(i => i.id === selectedInsumoId);
      if (!insumo) throw new Error("Insumo no encontrado.");
      let delta;
      let tipoGuardar;
      if (insumosAjusteTipo === "compra") {
        const cantidadCompra = parseFloat(dom.insumosCompraCantidad.value);
        if (isNaN(cantidadCompra) || cantidadCompra <= 0) throw new Error("Ingresa una cantidad valida.");
        delta = cantidadCompra * insumo.factorConversion;
        tipoGuardar = "compra";
      } else {
        const nuevoStock = parseFloat(dom.insumosAjusteCantidad.value);
        if (isNaN(nuevoStock) || nuevoStock < 0) throw new Error("Ingresa un stock valido.");
        delta = parseFloat((nuevoStock - insumo.stockActual).toFixed(4));
        if (delta === 0) throw new Error("El stock no cambio. Modificá la cantidad para registrar el ajuste.");
        tipoGuardar = dom.insumosAjusteMotivos.querySelector("input[name='insumo-motivo']:checked")?.value;
        if (!tipoGuardar) throw new Error("Seleccioná el motivo del ajuste.");
      }
      await ajustarStockInsumo(selectedInsumoId, delta, tipoGuardar);
      const msgs = { compra: "Compra registrada", desperdicio: "Baja registrada", no_recibido: "Corrección registrada", error_conteo: "Corrección registrada" };
      setFlash(`${msgs[tipoGuardar] ?? "Ajuste registrado"}: ${insumo.nombre}.`, "success");
      closeInsumoAjusteSheet();
      await renderInsumosView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      insumosAjusteInProgress = false;
    }
  });

  dom.calibracionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (insumosCalibracionInProgress || !selectedInsumoId) return;
    try {
      insumosCalibracionInProgress = true;
      await calibrarInsumo(selectedInsumoId, dom.calibracionCantidad.value, calibracionAlphaReceta);
      setFlash("Calibracion guardada. Las cantidades se ajustaron.", "success");
      closeCalibracionSheet();
      if (currentView === "calibrar") await renderCalibracionView();
      else await renderInsumosView();
    } catch (error) {
      setFlash(error.message || "No se pudo calibrar.", "error");
    } finally {
      insumosCalibracionInProgress = false;
    }
  });

  dom.verListaCompras.addEventListener("click", async () => {
    insumosListaComprasVisible = !insumosListaComprasVisible;
    dom.listaComprasSection.hidden = !insumosListaComprasVisible;
    dom.verListaCompras.textContent = insumosListaComprasVisible ? "Cerrar lista" : "Lista de compras";
    if (insumosListaComprasVisible) {
      const smartData = await listaDeComprasSmart();
      renderListaComprasSmart(dom.listaComprasList, smartData);
    }
  });

  dom.exportListaCompras.addEventListener("click", async () => {
    const txt = await exportarListaCompras();
    await shareOrDownloadText(`lista-compras-${todayISO()}.txt`, txt, "text/plain");
    setFlash("Lista de compras exportada.", "success");
  });

  dom.closeRecetaEdit.addEventListener("click", closeRecetaEditSheet);
  dom.recetaEditBackdrop.addEventListener("click", closeRecetaEditSheet);

  dom.recetaEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (recetaEditInProgress || !selectedRecetaId) return;
    try {
      recetaEditInProgress = true;
      await actualizarReceta(selectedRecetaId, dom.recetaEditCantidad.value, dom.recetaEditMotivo.value);
      setFlash("Receta actualizada.", "success");
      closeRecetaEditSheet();
      await renderRecetasView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar la receta.", "error");
    } finally {
      recetaEditInProgress = false;
    }
  });

  dom.closeProvEdit.addEventListener("click", closeProvEdit);
  dom.provEditBackdrop.addEventListener("click", closeProvEdit);

  dom.closeProvProd.addEventListener("click", closeProvProd);
  dom.provProdBackdrop.addEventListener("click", closeProvProd);

  dom.provProdInsumo.addEventListener("change", updateProvProdCantidadLabel);

  dom.provEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (provEditInProgress || !selectedProvId) return;
    try {
      provEditInProgress = true;
      const nombre = dom.provEditNombre.value.trim();
      if (!nombre) throw new Error("El nombre no puede estar vacío.");
      await updateProveedor(selectedProvId, {
        nombre,
        tel: dom.provEditTel.value.trim(),
        email: dom.provEditEmail.value.trim(),
        notas: dom.provEditNotas.value.trim(),
        diasCiclo: Number(dom.provEditDias.value) || 7
      });
      setFlash("Proveedor actualizado.", "success");
      closeProvEdit();
      await renderProveedoresView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      provEditInProgress = false;
    }
  });

  dom.provProdForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (provProdInProgress || !selectedProvId) return;
    try {
      provProdInProgress = true;
      const nombre = dom.provProdNombre.value.trim();
      const unidad = dom.provProdUnidad.value.trim();
      const precio = parseFloat(dom.provProdPrecio.value);
      if (!nombre) throw new Error("El nombre del producto es obligatorio.");
      if (!unidad) throw new Error("La unidad de compra es obligatoria.");
      if (isNaN(precio) || precio < 0) throw new Error("Ingresa un precio válido.");
      const insumoId = dom.provProdInsumo.value || null;
      const cantidad = parseFloat(dom.provProdCantidad.value) || 1;
      await saveProveedorInsumo({
        id: provProdMode === "edit" ? selectedProvProdId : undefined,
        proveedorId: selectedProvId,
        insumoId,
        nombreProducto: nombre,
        unidadCompra: unidad,
        cantidadPorUnidad: cantidad,
        precioUnitarioCentavos: Math.round(precio * 100)
      });
      setFlash(provProdMode === "edit" ? "Producto actualizado." : "Producto agregado.", "success");
      closeProvProd();
      await renderProveedoresView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      provProdInProgress = false;
    }
  });

  window.addEventListener("hashchange", () => {
    const viewName = window.location.hash.replace("#", "") || "caja";
    if (["caja", "pedidos", "produccion", "historial", "gestion"].includes(viewName)) showView(viewName);
  });
}

function showLoginScreen(message) {
  dom.loginScreen.hidden = false;
  if (message) {
    dom.loginError.textContent = message;
    dom.loginError.hidden = false;
  }
}

function hideLoginScreen() {
  dom.loginScreen.hidden = true;
  dom.loginError.hidden = true;
}

// Supabase Auth exige formato de email, pero en pantalla solo se pide el
// nombre de usuario (augusto, sharon, guada) -- se le agrega el dominio aca
// para que nadie tenga que escribir ni ver un "@" en la tablet.
const LOGIN_DOMAIN = "migapos.local";

function toLoginEmail(username) {
  const clean = username.trim().toLowerCase();
  return clean.includes("@") ? clean : `${clean}@${LOGIN_DOMAIN}`;
}

function bindAuthEvents() {
  dom.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    dom.loginError.hidden = true;
    const email = toLoginEmail(dom.loginEmail.value);
    const password = dom.loginPassword.value;
    const submitBtn = dom.loginForm.querySelector("button[type='submit']");
    try {
      submitBtn.disabled = true;
      await signIn(email, password);
      dom.loginForm.reset();
      hideLoginScreen();
      await bootApp();
    } catch {
      dom.loginError.textContent = "Email o contraseña incorrectos.";
      dom.loginError.hidden = false;
    } finally {
      submitBtn.disabled = false;
    }
  });

  dom.logoutButton.addEventListener("click", () => {
    signOut();
    window.location.reload();
  });
}

async function bootApp() {
  await seedDatabase();
  await seedInsumos();
  await seedProveedores();
  setupAutoSync();
  // Subir insumos y recetas a Supabase al arrancar (upsert idempotente)
  Promise.all([getAll("insumos"), getAll("recetas")]).then(([insumos, recetas]) => {
    trySyncInsumosSnapshot(insumos).catch(() => {});
    trySyncRecetasSnapshot(recetas).catch(() => {});
  }).catch(() => {});
  dom.historyDate.value = todayISO();
  bindEvents();
  const initialView = window.location.hash.replace("#", "") || "caja";
  showView(["caja", "pedidos", "produccion", "historial", "gestion"].includes(initialView) ? initialView : "caja");
}

export async function startApp() {
  bindAuthEvents();
  const session = await restoreSession();
  if (session) {
    hideLoginScreen();
    await bootApp();
  } else {
    showLoginScreen();
  }
}
