import { exportSalesSummary, exportDailySummaryJSON, exportSalesSummaryRange } from "../modules/backup.js";
import { signIn, signOut, restoreSession, fetchStockProductos, fetchVentasDelDia, fetchMovimientosStock } from "../db/supabase.js";
import { seedInsumos, listInsumos, ajustarStockInsumo, calibrarInsumo, listaDeComprasSmart, exportarListaCompras, getCalibracionDashboardData, getRecetasDashboardData, actualizarReceta, saveInsumoCalibrationSettings, previewProduccionInsumos, pullInsumosDesdeNube, createInsumo, sincronizarStockInsumosDesdeMovimientos } from "../modules/aprovisionamiento.js";
import { seedProveedores, getProveedoresDashboardData, updateProveedor, createProveedor, saveProveedorInsumo, deleteProveedorInsumo, pullProveedoresDesdeNube } from "../modules/proveedores.js";
import { renderProveedoresList, renderProvProdInsumoSelect, renderProvProdRecetaRows } from "../ui/render-proveedores.js";
import { getMenuDashboardData, saveProducto, setProductoActivo, moverProductoOrden, pullCatalogoDesdeNube } from "../modules/menu.js";
import { getGruposVariantes, saveGrupoVariante, deleteGrupoVariante, getGrupoDeProducto, setProductoGrupoVariante, pullVariantesGruposDesdeNube } from "../modules/variantes.js";
import { renderVariantesOpcionesRows, renderVariantesProductosChecklist, renderVariantesGruposList } from "../ui/render-variantes.js";
import { renderMenuList, renderMenuRecetaRows } from "../ui/render-menu.js";
import {
  trySyncVenta,
  trySyncMovimientosInsumos,
  trySyncCatalogoSnapshot,
  trySyncInsumosSnapshot,
  trySyncRecetasSnapshot,
  trySyncMovimientoStock,
  trySyncProveedoresSnapshot,
  trySyncProveedorInsumosSnapshot,
  trySyncVentaAnulada,
  setupAutoSync,
  getPendingSyncCount,
  processSyncQueue
} from "../modules/sync.js";
import { renderInsumosList, renderInsumoAjusteSelected, renderCalibracionAlert, renderListaComprasSmart, renderCalibracionDashboard, renderCalibracionRecetaSettings, renderRecetasEditor, renderFacturaLineas } from "../ui/render-aprovisionamiento.js";
import { archivoABase64, leerFactura, confirmarFactura } from "../modules/facturas.js";
import { fetchPedidosDelDia, crearPedido, editarPedido, eliminarPedido, marcarPedidoListo, marcarPedidoEntregado } from "../modules/pedidos.js";
import { renderPedidosGrid, renderPedidoProductPicker, formatPedidoTicket } from "../ui/render-pedidos.js";
import { shareOrDownloadText, shareText, printTicket } from "../utils/format.js";
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
  stockHistoricoPorFecha,
  undoSale,
  TOGOO_FLAT_TOTAL_CENTAVOS,
  sincronizarStockProductosDesdeMovimientos,
  datosRemotosDelDia
} from "../modules/business.js";
import { seedDatabase, getAll } from "../db/idb.js";
import { todayISO, centsToMoney, slugify } from "../utils/format.js";
import {
  filterProductButtons,
  renderCart,
  renderHistory,
  renderProductGrid,
  renderProduction,
  formatVentaTicket,
  renderStockConsulta,
  renderProduccionConsulta
} from "../ui/render.js";

const cart = new Map();
let products = [];
let categories = [];
let cartTotalCentavosActual = 0;
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
let facturaSheetOpen = false;
let facturaArchivoBase64 = null;
let facturaLineasActuales = [];
let facturaInProgress = false;
let facturaProveedorNuevoInfo = null;
let facturaProveedorIdActual = "";
let crearInsumoSheetOpen = false;
let crearInsumoInProgress = false;
let variantesOpcionesLineas = [];
let variantesProductosDisponibles = [];
let variantesInsumosDisponibles = [];
let variantesFormInProgress = false;
let selectedGrupoVarianteId = "";
let grupoVarianteMode = "add";
let lecheSheetOpen = false;
let productoPendienteSeleccion = null;

// Grupos de variante (ej: "Tipo de leche") que preguntan una opcion en caja
// antes de sumar el producto al carrito — editables desde Gestion >
// Variantes (variantes.js), cargados al arrancar y refrescados cada vez que
// se guarda un cambio ahi. Arranca vacio hasta el primer
// refreshGruposVariantes() en bootApp.
let gruposVariantesActual = [];

async function refreshGruposVariantes() {
  gruposVariantesActual = await getGruposVariantes();
}

// Todo lo que trae "Actualizar catalogo" de la nube — categorias/productos/
// recetas, insumos (definicion), proveedores, grupos de variante, y el
// merge por deltas del stock de insumos Y productos (ver
// sincronizarStockInsumosDesdeMovimientos en aprovisionamiento.js y
// sincronizarStockProductosDesdeMovimientos en business.js). Un solo punto
// para el boton manual Y para el auto-sync silencioso (ver
// sincronizarCatalogoSilencioso), asi nunca se desalinean.
async function pullCatalogoCompleto() {
  const [catalogo, insumosCount, proveedoresResult, variantesResult] = await Promise.all([
    pullCatalogoDesdeNube(),
    pullInsumosDesdeNube(),
    pullProveedoresDesdeNube(),
    pullVariantesGruposDesdeNube()
  ]);
  // Recien despues de que insumos/productos existan localmente (los pulls de
  // arriba ya terminaron) tiene sentido aplicarles deltas de stock — si algo
  // se creo en el otro dispositivo y todavia no llego, su primer movimiento
  // se descarta aca pero se aplica solo en el proximo refresco.
  const [stockResult, stockProductosResult] = await Promise.all([
    sincronizarStockInsumosDesdeMovimientos(),
    sincronizarStockProductosDesdeMovimientos()
  ]);
  await refreshGruposVariantes();
  await loadProducts();
  return { catalogo, insumosCount, proveedoresResult, variantesResult, stockResult, stockProductosResult };
}

let refrescarCatalogoStatusTimeout = null;

// Feedback del boton manual "Actualizar catalogo" — antes quedaba en el
// flash generico de la app (4 segundos, facil de perderse si no estabas
// mirando justo ahi) y volvia solo a su texto normal ante un error, sin
// ninguna llamada a la accion. Ahora: "loading" deja el boton deshabilitado
// (clickearlo de nuevo mientras corre no hace nada, ver refrescarCatalogoInProgress
// en el handler — apretarlo de mas nunca puede romper nada), "success" queda
// visible al lado del boton 20 segundos y se borra sola, y "error" dejar el
// boton mismo como "↻ Reintentar" — sin apagarse solo, hasta que se
// reintente y funcione.
function setRefrescarCatalogoEstado(estado, mensaje = "") {
  window.clearTimeout(refrescarCatalogoStatusTimeout);
  const boton = dom.refrescarCatalogo;
  const status = dom.refrescarCatalogoStatus;
  if (estado === "loading") {
    boton.disabled = true;
    boton.textContent = "Actualizando...";
    status.hidden = true;
    return;
  }
  if (estado === "success") {
    boton.disabled = false;
    boton.textContent = "Actualizar catalogo";
    status.hidden = false;
    status.className = "refrescar-catalogo-status success";
    status.textContent = `✓ ${mensaje}`;
    refrescarCatalogoStatusTimeout = window.setTimeout(() => {
      status.hidden = true;
    }, 20000);
    return;
  }
  // error
  boton.disabled = false;
  boton.textContent = "↻ Reintentar";
  status.hidden = false;
  status.className = "refrescar-catalogo-status error";
  status.textContent = `✗ ${mensaje}`;
}

// Auto-sync SIN boton: se llama al abrir la app y cada vez que se entra a
// Gestion desde otra vista (ver bootApp/showView) — nunca durante Caja, para
// que jamas compita con una venta en curso (ver el hilo con el usuario del
// 19/09: si el precio de un producto cambiara a mitad de armar un carrito,
// confirmSale cobraria el precio nuevo aunque el carrito en pantalla siga
// mostrando el viejo — evitamos la clase entera de bug no corriendo esto
// mientras se puede estar vendiendo). Totalmente silencioso: sin flash de
// exito (seria ruido en cada apertura) ni de error (offline es normal y
// esperado, no una falla que haya que mostrarle a quien cobra). Comparte el
// mismo guard que el boton manual para nunca pisarse con un click del
// usuario ni con otra corrida automatica en simultaneo.
async function sincronizarCatalogoSilencioso() {
  if (refrescarCatalogoInProgress) return;
  refrescarCatalogoInProgress = true;
  try {
    await pullCatalogoCompleto();
    if (currentView === "gestion") await refreshGestionSubView(currentGestionSubView);
  } catch {
    // silencioso a proposito — ver comentario de arriba
  } finally {
    refrescarCatalogoInProgress = false;
  }
}

// "Promo bebida" no dice que bebida es — se pregunta antes de sumarla al
// carrito, con las opciones reales de la categoria Bebidas.
const PRODUCTOS_CON_BEBIDA_A_ELEGIR = new Set(["promo-bebida"]);
let recetaEditInProgress = false;
let selectedRecetaId = "";
let recetaEditSheetOpen = false;
let calibracionAlphaReceta = null;
let provEditInProgress = false;
let provProdInProgress = false;
let selectedProvId = "";
let selectedProvProdId = "";
let provProdMode = "add";
let provEditMode = "edit";
let provProdRecetaVinculos = [];
let provProdProductosDisponibles = [];
let provEditSheetOpen = false;
let provProdSheetOpen = false;
let menuEditInProgress = false;
let refrescarCatalogoInProgress = false;
let historialRangoInProgress = false;
let selectedMenuProductoId = "";
let menuProductoMode = "add";
let menuEditSheetOpen = false;
let menuRecetaLineas = [];
let menuInsumosDisponibles = [];
let menuGruposVarianteDisponibles = [];
const pedidoCart = new Map();
const expandedPedidoIds = new Set();
let pedidoSheetOpen = false;
let editingPedidoId = null;
let pedidoCreateInProgress = false;
let pedidoActionInProgress = false;
let undoSaleInProgress = false;
let pedidosPollTimer = null;
let pedidoPrecioEditadoManualmente = false;
let currentGestionSubView = "insumos";

// "Modo consulta": flag por dispositivo (no por cuenta) para los aparatos que
// solo miran el local (Sharon, Guadalupe, etc). En ese modo, Caja/Produccion/
// Historial leen de Supabase en vez de IDB local y esconden las acciones de
// escritura. El dispositivo que realmente opera (la tablet del local) lo deja
// apagado y sigue funcionando exactamente igual que siempre.
const MODO_CONSULTA_KEY = "miga_modo_consulta";
let consultaPollTimer = null;

function isModoConsulta() {
  try { return localStorage.getItem(MODO_CONSULTA_KEY) === "1"; }
  catch { return false; }
}

function setModoConsulta(activo) {
  try { localStorage.setItem(MODO_CONSULTA_KEY, activo ? "1" : "0"); }
  catch { /* localStorage no disponible — ignorar */ }
}

// La primera vez que un dispositivo arranca (nunca se toco el toggle a mano),
// se decide el default solo: si ya tiene ventas guardadas localmente, es la
// tablet que opera de verdad -> modo consulta apagado. Si no tiene ninguna
// (un celular nuevo que nunca vendio nada), es un dispositivo de consulta ->
// modo consulta prendido de entrada, sin tener que tocar nada.
async function initModoConsultaDefault() {
  let yaConfigurado = false;
  try { yaConfigurado = localStorage.getItem(MODO_CONSULTA_KEY) !== null; } catch { /* ignorar */ }
  if (yaConfigurado) return;
  let defaultConsulta = true;
  try {
    const ventas = await getAll("ventas");
    defaultConsulta = ventas.length === 0;
  } catch { /* si falla, default mas seguro: consulta prendida */ }
  setModoConsulta(defaultConsulta);
}


const dom = {
  loginScreen: document.querySelector("#login-screen"),
  loginForm: document.querySelector("#login-form"),
  loginEmail: document.querySelector("#login-email"),
  loginPassword: document.querySelector("#login-password"),
  loginError: document.querySelector("#login-error"),
  logoutButton: document.querySelector("#logout-button"),
  appMessage: document.querySelector("#app-message"),
  syncStatusBadge: document.querySelector("#sync-status-badge"),
  navLinks: document.querySelectorAll(".nav:not(.sub-nav) > .nav-link"),
  views: document.querySelectorAll(".view"),
  productCategories: document.querySelector("#product-categories"),
  salesLayout: document.querySelector("#sales-layout"),
  cajaConsulta: document.querySelector("#caja-consulta"),
  lecheBackdrop: document.querySelector("#leche-backdrop"),
  lecheSheet: document.querySelector("#leche-sheet"),
  closeLeche: document.querySelector("#close-leche"),
  lecheSheetTitulo: document.querySelector("#leche-sheet-titulo"),
  lecheProductoNombre: document.querySelector("#leche-producto-nombre"),
  lecheOpciones: document.querySelector("#leche-opciones"),
  salesSearch: document.querySelector("#sales-search"),
  clearSalesSearch: document.querySelector("#clear-sales-search"),
  salesSearchEmpty: document.querySelector("#sales-search-empty"),
  cartItems: document.querySelector("#cart-items"),
  cartSandwichCount: document.querySelector("#cart-sandwich-count"),
  cartTotal: document.querySelector("#cart-total"),
  pagoCon: document.querySelector("#pago-con"),
  vueltoResultado: document.querySelector("#vuelto-resultado"),
  vueltoValor: document.querySelector("#vuelto-valor"),
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
  productionBebidasList: document.querySelector("#production-bebidas-list"),
  productionGroups: document.querySelector("#production-groups"),
  produccionConsulta: document.querySelector("#produccion-consulta"),
  closePeriodButton: document.querySelector("#close-period-button"),
  refrescarCatalogo: document.querySelector("#refrescar-catalogo"),
  refrescarCatalogoStatus: document.querySelector("#refrescar-catalogo-status"),
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
  historialBackupPanel: document.querySelector("#historial-backup-panel"),
  exportSalesSummary: document.querySelector("#export-sales-summary"),
  exportSalesJson: document.querySelector("#export-sales-json"),
  historialRangoForm: document.querySelector("#historial-rango-form"),
  historialRangoDesde: document.querySelector("#historial-rango-desde"),
  historialRangoHasta: document.querySelector("#historial-rango-hasta"),
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
  confirmDialogBackdrop: document.querySelector("#confirm-dialog-backdrop"),
  confirmDialog: document.querySelector("#confirm-dialog"),
  confirmDialogTitle: document.querySelector("#confirm-dialog-title"),
  confirmDialogMessage: document.querySelector("#confirm-dialog-message"),
  confirmDialogAccept: document.querySelector("#confirm-dialog-accept"),
  confirmDialogCancel: document.querySelector("#confirm-dialog-cancel"),
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
  abrirFactura: document.querySelector("#abrir-factura"),
  abrirCrearInsumo: document.querySelector("#abrir-crear-insumo"),
  crearInsumoBackdrop: document.querySelector("#crear-insumo-backdrop"),
  crearInsumoSheet: document.querySelector("#crear-insumo-sheet"),
  closeCrearInsumo: document.querySelector("#close-crear-insumo"),
  crearInsumoForm: document.querySelector("#crear-insumo-form"),
  crearInsumoNombre: document.querySelector("#crear-insumo-nombre"),
  crearInsumoUnidad: document.querySelector("#crear-insumo-unidad"),
  crearInsumoMin: document.querySelector("#crear-insumo-min"),
  crearInsumoCrit: document.querySelector("#crear-insumo-crit"),
  facturaBackdrop: document.querySelector("#factura-backdrop"),
  facturaSheet: document.querySelector("#factura-sheet"),
  closeFactura: document.querySelector("#close-factura"),
  facturaProveedor: document.querySelector("#factura-proveedor"),
  facturaProveedorNuevoFields: document.querySelector("#factura-proveedor-nuevo-fields"),
  facturaProveedorNombre: document.querySelector("#factura-proveedor-nombre"),
  facturaProveedorTel: document.querySelector("#factura-proveedor-tel"),
  facturaProveedorEmail: document.querySelector("#factura-proveedor-email"),
  facturaProveedorDias: document.querySelector("#factura-proveedor-dias"),
  facturaSacarFoto: document.querySelector("#factura-sacar-foto"),
  facturaAdjuntar: document.querySelector("#factura-adjuntar"),
  facturaInputFoto: document.querySelector("#factura-input-foto"),
  facturaInputAdjunto: document.querySelector("#factura-input-adjunto"),
  facturaArchivoNombre: document.querySelector("#factura-archivo-nombre"),
  facturaPasoUpload: document.querySelector("#factura-paso-upload"),
  facturaPasoCargando: document.querySelector("#factura-paso-cargando"),
  facturaPasoRevision: document.querySelector("#factura-paso-revision"),
  facturaResumen: document.querySelector("#factura-resumen"),
  facturaLineas: document.querySelector("#factura-lineas"),
  facturaContinuar: document.querySelector("#factura-continuar"),
  facturaConfirmar: document.querySelector("#factura-confirmar"),
  proveedoresList: document.querySelector("#proveedores-list"),
  provAddNuevo: document.querySelector("#prov-add-nuevo"),
  provEditSheet: document.querySelector("#prov-edit-sheet"),
  provEditBackdrop: document.querySelector("#prov-edit-backdrop"),
  provEditTitle: document.querySelector("#prov-edit-title"),
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
  provProdNuevoInsumoFields: document.querySelector("#prov-prod-nuevo-insumo-fields"),
  provProdNuevoNombre: document.querySelector("#prov-prod-nuevo-nombre"),
  provProdNuevoUnidad: document.querySelector("#prov-prod-nuevo-unidad"),
  provProdNuevoMin: document.querySelector("#prov-prod-nuevo-min"),
  provProdNuevoCrit: document.querySelector("#prov-prod-nuevo-crit"),
  provProdRecetaRows: document.querySelector("#prov-prod-receta-rows"),
  provProdAddRecetaRow: document.querySelector("#prov-prod-add-receta-row"),
  provProdCantidadLabel: document.querySelector("#prov-prod-cantidad-label"),
  provProdCantidad: document.querySelector("#prov-prod-cantidad"),
  provProdPrecio: document.querySelector("#prov-prod-precio"),
  menuList: document.querySelector("#menu-list"),
  menuEditSheet: document.querySelector("#menu-edit-sheet"),
  menuEditBackdrop: document.querySelector("#menu-edit-backdrop"),
  closeMenuEdit: document.querySelector("#close-menu-edit"),
  menuEditForm: document.querySelector("#menu-edit-form"),
  menuEditTitle: document.querySelector("#menu-edit-title"),
  menuEditNombre: document.querySelector("#menu-edit-nombre"),
  menuEditCategoria: document.querySelector("#menu-edit-categoria"),
  menuEditPrecio: document.querySelector("#menu-edit-precio"),
  menuEditTipoWrap: document.querySelector("#menu-edit-tipo-wrap"),
  menuEditSandwichTipo: document.querySelector("#menu-edit-sandwich-tipo"),
  menuEditControlaStock: document.querySelector("#menu-edit-controla-stock"),
  menuEditUmbral: document.querySelector("#menu-edit-umbral"),
  menuEditActivo: document.querySelector("#menu-edit-activo"),
  menuRecetaRows: document.querySelector("#menu-receta-rows"),
  menuAddRecetaRow: document.querySelector("#menu-add-receta-row"),
  variantesGruposList: document.querySelector("#variantes-grupos-list"),
  varianteAddGrupo: document.querySelector("#variante-add-grupo"),
  varianteGrupoBackdrop: document.querySelector("#variante-grupo-backdrop"),
  varianteGrupoSheet: document.querySelector("#variante-grupo-sheet"),
  varianteGrupoTitle: document.querySelector("#variante-grupo-title"),
  closeVarianteGrupo: document.querySelector("#close-variante-grupo"),
  varianteGrupoForm: document.querySelector("#variante-grupo-form"),
  varianteGrupoNombre: document.querySelector("#variante-grupo-nombre"),
  varianteGrupoTitulo: document.querySelector("#variante-grupo-titulo"),
  varianteGrupoOpcionesRows: document.querySelector("#variante-grupo-opciones-rows"),
  varianteGrupoAddOpcion: document.querySelector("#variante-grupo-add-opcion"),
  varianteGrupoProductosChecklist: document.querySelector("#variante-grupo-productos-checklist"),
  menuEditVariante: document.querySelector("#menu-edit-variante"),
  pedidosGrid: document.querySelector("#pedidos-grid"),
  openNuevoPedido: document.querySelector("#open-nuevo-pedido"),
  pedidoSheet: document.querySelector("#pedido-sheet"),
  pedidoSheetTitle: document.querySelector("#pedido-sheet-title"),
  pedidoSheetBackdrop: document.querySelector("#pedido-sheet-backdrop"),
  closePedidoSheet: document.querySelector("#close-pedido-sheet"),
  pedidoForm: document.querySelector("#pedido-form"),
  pedidoProductPicker: document.querySelector("#pedido-product-picker"),
  pedidoCartItems: document.querySelector("#pedido-cart-items"),
  pedidoCartTotal: document.querySelector("#pedido-cart-total"),
  pedidoClienteNombre: document.querySelector("#pedido-cliente-nombre"),
  pedidoFechaRetiro: document.querySelector("#pedido-fecha-retiro"),
  pedidoHoraRetiro: document.querySelector("#pedido-hora-retiro"),
  pedidoPrecioTotal: document.querySelector("#pedido-precio-total"),
  pedidoComboHint: document.querySelector("#pedido-combo-hint"),
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

// Antes esto era invisible: si un push a Supabase fallaba por un motivo que
// no fuera "sin conexion" (timeout, error puntual de wifi debil), la
// operacion quedaba encolada para siempre sin que nadie se enterara — asi se
// perdio produccion real que nunca llego a la nube. El badge muestra cuanto
// hay pendiente y permite forzar un reintento con un tap.
function updateSyncBadge() {
  if (!dom.syncStatusBadge) return;
  const pending = getPendingSyncCount();
  if (pending === 0) {
    dom.syncStatusBadge.hidden = true;
    return;
  }
  dom.syncStatusBadge.hidden = false;
  dom.syncStatusBadge.textContent = `⚠ ${pending} sin sincronizar`;
}

function setupSyncBadge() {
  updateSyncBadge();
  window.setInterval(updateSyncBadge, 20000);
  dom.syncStatusBadge?.addEventListener("click", async () => {
    dom.syncStatusBadge.disabled = true;
    const resultado = await processSyncQueue().catch((e) => ({ synced: 0, pending: getPendingSyncCount(), lastError: { type: "?", message: e.message } }));
    const { synced, pending, offline, lastError } = resultado;
    dom.syncStatusBadge.disabled = false;
    updateSyncBadge();
    if (synced > 0 && pending === 0) setFlash(`${synced} sincronizados. Todo al dia.`);
    else if (synced > 0) setFlash(`${synced} sincronizados, ${pending} pendientes todavia.`, "warning");
    else if (offline) setFlash("Sin conexion — se reintenta solo cuando vuelva el wifi.", "warning");
    else if (lastError) setFlash(`No se pudo sincronizar (${lastError.type}): ${lastError.message}`, "error");
    else setFlash("No hay cambios pendientes.", "warning");
  });
}

// Reemplaza window.confirm con un modal propio (mismo estilo que el resto de
// la app). Devuelve una Promise<boolean> igual que confirm(), asi que se usa
// con await en el lugar de la llamada.
function confirmDialog({ title = "Confirmar", message, acceptText = "Confirmar", cancelText = "Cancelar" }) {
  return new Promise((resolve) => {
    dom.confirmDialogTitle.textContent = title;
    dom.confirmDialogMessage.textContent = message;
    dom.confirmDialogAccept.textContent = acceptText;
    dom.confirmDialogCancel.textContent = cancelText;

    function close(result) {
      dom.confirmDialog.classList.remove("open");
      dom.confirmDialog.setAttribute("aria-hidden", "true");
      dom.confirmDialogBackdrop.classList.remove("open");
      dom.confirmDialogBackdrop.hidden = true;
      dom.confirmDialogAccept.removeEventListener("click", onAccept);
      dom.confirmDialogCancel.removeEventListener("click", onCancel);
      dom.confirmDialogBackdrop.removeEventListener("click", onCancel);
      resolve(result);
    }
    function onAccept() { close(true); }
    function onCancel() { close(false); }

    dom.confirmDialogAccept.addEventListener("click", onAccept);
    dom.confirmDialogCancel.addEventListener("click", onCancel);
    dom.confirmDialogBackdrop.addEventListener("click", onCancel);

    dom.confirmDialogBackdrop.hidden = false;
    dom.confirmDialogBackdrop.classList.add("open");
    dom.confirmDialog.classList.add("open");
    dom.confirmDialog.setAttribute("aria-hidden", "false");
  });
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

const CONSULTA_VIEWS = ["caja", "produccion", "historial"];

function stopConsultaPolling() {
  if (consultaPollTimer) {
    window.clearInterval(consultaPollTimer);
    consultaPollTimer = null;
  }
}

function startConsultaPolling() {
  stopConsultaPolling();
  consultaPollTimer = window.setInterval(() => { refreshView(); }, 60000);
}

function closeAllGestionSheets() {
  setInsumosAjusteSheetOpen(false);
  setInsumosCalibracionSheetOpen(false);
  setRecetaEditSheetOpen(false);
  setProvEditSheetOpen(false);
  setProvProdSheetOpen(false);
  setFacturaSheetOpen(false);
  setMenuEditSheetOpen(false);
  setCrearInsumoSheetOpen(false);
  setVarianteGrupoSheetOpen(false);
}

function setFacturaSheetOpen(isOpen) {
  facturaSheetOpen = isOpen;
  dom.facturaSheet.classList.toggle("open", isOpen);
  dom.facturaSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.facturaBackdrop.hidden = !isOpen;
  dom.facturaBackdrop.classList.toggle("open", isOpen);
}

function setCrearInsumoSheetOpen(isOpen) {
  crearInsumoSheetOpen = isOpen;
  dom.crearInsumoSheet.classList.toggle("open", isOpen);
  dom.crearInsumoSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.crearInsumoBackdrop.hidden = !isOpen;
  dom.crearInsumoBackdrop.classList.toggle("open", isOpen);
}

function openCrearInsumoSheet() {
  dom.crearInsumoNombre.value = "";
  dom.crearInsumoUnidad.value = "";
  dom.crearInsumoMin.value = "";
  dom.crearInsumoCrit.value = "";
  setCrearInsumoSheetOpen(true);
  dom.crearInsumoNombre.focus();
}

function closeCrearInsumoSheet() {
  setCrearInsumoSheetOpen(false);
}

function mostrarPasoFactura(paso) {
  dom.facturaPasoUpload.hidden = paso !== "upload";
  dom.facturaPasoCargando.hidden = paso !== "cargando";
  dom.facturaPasoRevision.hidden = paso !== "revision";
  dom.facturaContinuar.hidden = paso !== "upload";
  dom.facturaConfirmar.hidden = paso !== "revision";
}

async function openFacturaSheet() {
  const proveedores = (await getAll("proveedores"))
    .filter((p) => p.activo)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  dom.facturaProveedor.innerHTML =
    proveedores.map((p) => `<option value="${p.id}">${p.nombre}</option>`).join("") +
    `<option value="__nuevo__">+ Crear proveedor nuevo…</option>`;
  dom.facturaProveedorNuevoFields.hidden = true;
  dom.facturaProveedorNombre.value = "";
  dom.facturaProveedorTel.value = "";
  dom.facturaProveedorEmail.value = "";
  dom.facturaProveedorDias.value = "7";
  facturaArchivoBase64 = null;
  facturaLineasActuales = [];
  dom.facturaArchivoNombre.textContent = "";
  actualizarFacturaContinuarDisabled();
  mostrarPasoFactura("upload");
  setFacturaSheetOpen(true);
}

function closeFacturaSheet() {
  setFacturaSheetOpen(false);
  facturaArchivoBase64 = null;
  facturaLineasActuales = [];
  facturaProveedorNuevoInfo = null;
  facturaProveedorIdActual = "";
  dom.facturaInputFoto.value = "";
  dom.facturaInputAdjunto.value = "";
}

// "Leer factura" necesita un archivo, y si el proveedor es "nuevo" tambien
// un nombre — sin esto no hay con que crearlo al confirmar.
function actualizarFacturaContinuarDisabled() {
  const esProveedorNuevo = dom.facturaProveedor.value === "__nuevo__";
  const nombreListo = !esProveedorNuevo || dom.facturaProveedorNombre.value.trim().length > 0;
  dom.facturaContinuar.disabled = !facturaArchivoBase64 || !nombreListo;
}

function handleFacturaProveedorChange() {
  const esProveedorNuevo = dom.facturaProveedor.value === "__nuevo__";
  dom.facturaProveedorNuevoFields.hidden = !esProveedorNuevo;
  actualizarFacturaContinuarDisabled();
}

async function handleFacturaArchivoSeleccionado(file) {
  if (!file) return;
  try {
    facturaArchivoBase64 = await archivoABase64(file);
    dom.facturaArchivoNombre.textContent = `Archivo: ${file.name}`;
    actualizarFacturaContinuarDisabled();
  } catch (error) {
    setFlash(error.message || "No se pudo leer el archivo.", "error");
  }
}

async function handleFacturaLeer() {
  if (facturaInProgress || !facturaArchivoBase64) return;
  facturaInProgress = true;
  mostrarPasoFactura("cargando");
  try {
    const esProveedorNuevo = dom.facturaProveedor.value === "__nuevo__";
    let proveedorId = dom.facturaProveedor.value;
    let proveedorNombre = dom.facturaProveedor.selectedOptions[0]?.textContent || proveedorId;

    if (esProveedorNuevo) {
      const nombreNuevo = dom.facturaProveedorNombre.value.trim();
      if (!nombreNuevo) throw new Error("Escribi el nombre del proveedor nuevo.");
      const existentes = await getAll("proveedores");
      const idsUsados = new Set(existentes.map((p) => p.id));
      proveedorId = slugify(nombreNuevo);
      let sufijo = 2;
      while (idsUsados.has(proveedorId)) {
        proveedorId = `${slugify(nombreNuevo)}-${sufijo}`;
        sufijo += 1;
      }
      proveedorNombre = nombreNuevo;
      // No se crea el proveedor todavia — recien al confirmar (ver
      // handleFacturaConfirmar). Este id "provisorio" solo sirve para que la
      // IA arme el pedido; si el usuario cancela ahora, no queda nada creado.
      facturaProveedorNuevoInfo = {
        id: proveedorId,
        nombre: nombreNuevo,
        tel: dom.facturaProveedorTel.value.trim(),
        email: dom.facturaProveedorEmail.value.trim(),
        diasCiclo: Number(dom.facturaProveedorDias.value) || 7
      };
    } else {
      facturaProveedorNuevoInfo = null;
    }

    const items = await leerFactura(proveedorId, facturaArchivoBase64);
    if (items.length === 0) {
      throw new Error("No se detecto ninguna linea en la factura. Proba con otra foto.");
    }
    facturaProveedorIdActual = proveedorId;
    facturaLineasActuales = items;
    const insumos = await listInsumos();
    dom.facturaResumen.textContent =
      `${proveedorNombre} · ${items.length} línea${items.length === 1 ? "" : "s"} detectada${items.length === 1 ? "" : "s"}`;
    renderFacturaLineas(dom.facturaLineas, facturaLineasActuales, insumos);
    mostrarPasoFactura("revision");
  } catch (error) {
    setFlash(error.message || "No se pudo leer la factura.", "error");
    mostrarPasoFactura("upload");
  } finally {
    facturaInProgress = false;
  }
}

function leerLineasDelFormulario() {
  return Array.from(dom.facturaLineas.querySelectorAll(".factura-linea")).map((card) => {
    const insumoSelect = card.querySelector(".factura-insumo-select");
    const esNuevo = insumoSelect.value === "__nuevo__";
    return {
      insumoId: esNuevo ? null : insumoSelect.value,
      nombreDetectado: card.querySelector("strong").textContent,
      cantidad: Number(card.querySelector(".factura-cantidad").value) || 0,
      unidad: card.querySelector(".factura-unidad").value.trim(),
      precio: Number(card.querySelector(".factura-precio").value) || 0,
      cantidadPorUnidad: Number(card.querySelector(".factura-contenido").value) || 0,
      esNuevo,
      nuevoNombre: esNuevo ? card.querySelector(".factura-nuevo-nombre").value.trim() : undefined,
      nuevaUnidad: esNuevo ? card.querySelector(".factura-nueva-unidad").value.trim() : undefined,
      nuevoStockMinimo: esNuevo ? card.querySelector(".factura-nuevo-min").value : undefined,
      nuevoStockCritico: esNuevo ? card.querySelector(".factura-nuevo-crit").value : undefined
    };
  });
}

async function handleFacturaConfirmar() {
  if (facturaInProgress) return;
  facturaInProgress = true;
  try {
    const proveedorId = facturaProveedorIdActual;
    const lineas = leerLineasDelFormulario();
    if (lineas.some((l) => l.cantidad <= 0)) {
      throw new Error("Todas las líneas necesitan una cantidad mayor a 0.");
    }
    if (lineas.some((l) => l.esNuevo && !l.nuevoNombre)) {
      throw new Error("Completa el nombre de cada insumo nuevo.");
    }
    const { insumosActualizados } = await confirmarFactura(proveedorId, lineas, facturaProveedorNuevoInfo);
    setFlash(
      `Factura cargada: ${insumosActualizados} insumo${insumosActualizados === 1 ? "" : "s"} actualizado${insumosActualizados === 1 ? "" : "s"}${facturaProveedorNuevoInfo ? " · proveedor creado" : ""}.`,
      "success"
    );
    closeFacturaSheet();
    await refreshGestionSubView("insumos");
  } catch (error) {
    setFlash(error.message || "No se pudo confirmar la factura.", "error");
  } finally {
    facturaInProgress = false;
  }
}

async function refreshGestionSubView(subViewName) {
  if (subViewName === "insumos") await renderInsumosView();
  if (subViewName === "calibrar") await renderCalibracionView();
  if (subViewName === "recetas") await renderRecetasView();
  if (subViewName === "proveedores") await renderProveedoresView();
  if (subViewName === "menu") await renderMenuView();
  if (subViewName === "variantes") await renderVariantesView();
}

function showGestionSubView(subViewName) {
  closeAllGestionSheets();
  currentGestionSubView = subViewName;
  document.querySelectorAll(".subview").forEach((section) => section.classList.toggle("active", section.id === `subview-${subViewName}`));
  document.querySelectorAll(".sub-nav-link").forEach((link) => link.classList.toggle("active", link.dataset.subview === subViewName));
  refreshGestionSubView(subViewName);
}

function showView(viewName) {
  const vistaAnterior = currentView;
  currentView = viewName;
  // Auto-sync silencioso solo al ENTRAR a Gestion desde otra vista (no en
  // cada cambio de sub-pestaña interna, eso lo maneja showGestionSubView) —
  // nunca mientras se esta en Caja, ver sincronizarCatalogoSilencioso.
  if (viewName === "gestion" && vistaAnterior !== "gestion") {
    sincronizarCatalogoSilencioso();
  }
  if (viewName !== "caja") {
    setLecheSheetOpen(false);
  }
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
  if (!CONSULTA_VIEWS.includes(viewName)) {
    stopConsultaPolling();
  }
  dom.views.forEach((view) => view.classList.toggle("active", view.id === `view-${viewName}`));
  dom.navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === viewName));
  window.location.hash = viewName;
  refreshView(viewName);
  if (viewName === "pedidos") startPedidosPolling();
  if (isModoConsulta() && CONSULTA_VIEWS.includes(viewName)) startConsultaPolling();
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
  renderProductGrid(dom.productCategories, categories, displayProducts, handleProductTap);
  filterProductButtons(dom.salesSearch, dom.salesSearchEmpty);
}

function setCartMode(mode) {
  if (mode === cartMode) return;
  // ToGoo es una condicion del carrito, no un modo que lo reinicia: si ya
  // habia productos cargados, se re-etiquetan con el nuevo modo en vez de
  // perderse (antes esto vaciaba el carrito entero al tocar el switch).
  if (cart.size > 0) {
    const itemsPrevios = Array.from(cart.values());
    cart.clear();
    for (const item of itemsPrevios) {
      const cartKey = item.opcionNombre ? `${item.id}:${mode}:${item.opcionNombre}` : `${item.id}:${mode}`;
      cart.set(cartKey, { ...item, cartKey, saleMode: mode });
    }
    setSaleMessage(mode === "togoo" ? "Carrito marcado como ToGoo." : "Carrito marcado como venta normal.", true);
  }
  cartMode = mode;
  dom.cartModeTogooToggle.checked = mode === "togoo";
  renderReservedStock();
  renderCurrentCart();
}

function addToCart(product, opcionNombre = null) {
  const mode = cartMode;
  const cartKey = opcionNombre ? `${product.id}:${mode}:${opcionNombre}` : `${product.id}:${mode}`;
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
    opcionNombre,
    displayName: opcionNombre ? `${product.nombre} (${opcionNombre})` : product.nombre,
    quantity: nextQuantity,
    unitOrders: [...(current?.unitOrders || []), cartOrder += 1]
  });
  setSaleMessage("");
  renderReservedStock();
  renderCurrentCart();
}

function handleProductTap(product) {
  const grupoVariante = gruposVariantesActual.find((g) => g.productoIds.includes(product.id));
  if (grupoVariante) {
    abrirSelectorOpciones(product, grupoVariante.titulo, grupoVariante.opciones.map((o) => o.nombre));
    return;
  }
  if (PRODUCTOS_CON_BEBIDA_A_ELEGIR.has(product.id)) {
    const opcionesBebida = products
      .filter((p) => p.categoriaId === "bebidas")
      .sort((a, b) => (a.orden || 0) - (b.orden || 0))
      .map((p) => p.nombre);
    abrirSelectorOpciones(product, "¿Qué bebida?", opcionesBebida);
    return;
  }
  addToCart(product);
}

function setLecheSheetOpen(isOpen) {
  lecheSheetOpen = isOpen;
  dom.lecheSheet.classList.toggle("open", isOpen);
  dom.lecheSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.lecheBackdrop.hidden = !isOpen;
  dom.lecheBackdrop.classList.toggle("open", isOpen);
}

// Modal generico de "elegi una opcion antes de sumar al carrito" — lo usan
// tanto la seleccion de leche como la seleccion de bebida en Promo bebida.
function abrirSelectorOpciones(product, titulo, opciones) {
  productoPendienteSeleccion = product;
  dom.lecheSheetTitulo.textContent = titulo;
  dom.lecheProductoNombre.textContent = product.nombre;
  dom.lecheOpciones.innerHTML = opciones
    .map((op) => `<button type="button" class="leche-opcion" data-opcion="${op}">${op}</button>`)
    .join("");
  setLecheSheetOpen(true);
}

function closeLecheSheet() {
  setLecheSheetOpen(false);
  productoPendienteSeleccion = null;
}

function seleccionarOpcion(nombreElegido) {
  if (!productoPendienteSeleccion) return;
  addToCart(productoPendienteSeleccion, nombreElegido);
  closeLecheSheet();
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
  cartTotalCentavosActual = pricing.totalCentavos + (hasTogoo ? TOGOO_FLAT_TOTAL_CENTAVOS : 0);
  renderCart(
    dom.cartItems,
    dom.cartSandwichCount,
    dom.cartTotal,
    dom.confirmSale,
    cart,
    changeQuantity,
    { ...pricing, totalCentavos: cartTotalCentavosActual }
  );
  recalcularVuelto();
}

// Calculadora de vuelto: puramente un ayuda-memoria visual para el empleado,
// no se guarda en ningun lado ni afecta la venta — el monto que realmente se
// cobra sigue siendo el total del carrito.
function recalcularVuelto() {
  const pago = Number(dom.pagoCon.value);
  if (!dom.pagoCon.value || !(pago > 0)) {
    dom.vueltoResultado.hidden = true;
    return;
  }
  const pagoCentavos = Math.round(pago * 100);
  const diferencia = pagoCentavos - cartTotalCentavosActual;
  dom.vueltoResultado.hidden = false;
  dom.vueltoValor.textContent = diferencia >= 0
    ? centsToMoney(diferencia)
    : `Falta ${centsToMoney(-diferencia)}`;
}

function resetVuelto() {
  dom.pagoCon.value = "";
  dom.vueltoResultado.hidden = true;
}

async function loadProducts() {
  [categories, products] = await Promise.all([listCategories(), listProducts()]);
}

// Catalogo local (nombre/precio/categoria, igual en todos los dispositivos
// via seed) con el stock actual pisado por el ultimo valor que pusheo el
// dispositivo que realmente opera. Solo se usa para "modo consulta".
async function catalogoConStockRemoto() {
  const [catalogo, stockRemoto] = await Promise.all([listProducts(), fetchStockProductos()]);
  const stockById = new Map(stockRemoto.map((row) => [row.id, Number(row.stock_actual)]));
  return catalogo.map((product) => ({
    ...product,
    stockActual: stockById.has(product.id) ? stockById.get(product.id) : product.stockActual
  }));
}

// En modo consulta, cada poll (cada 60s) vuelve a llamar a estas funciones.
// Si tapamos el contenido con "Cargando..." en cada refresh, el contenedor se
// achica un instante y la pagina "salta" al encabezado. Por eso el placeholder
// solo se muestra la primera vez; despues el contenido viejo queda a la vista
// hasta que el nuevo esta listo.
function showConsultaPlaceholder(container, text) {
  if (container.dataset.loaded === "1") return;
  container.textContent = text;
}

function markConsultaLoaded(container) {
  container.dataset.loaded = "1";
}

// produccion/ajuste_manual/ajuste_stock cuentan todos (recuento, consumo,
// error, pedidos offline, cierre de periodo...) — venta/devolucion quedan
// afuera a proposito, esas se resumen aparte en "Vendidos hoy". Igual filtro
// que productionSnapshot() en business.js, aplicado aca sobre los
// movimientos traidos de Supabase.
function esMovimientoDeProduccion(row) {
  return row.tipo === "produccion" || row.tipo === "ajuste_manual" || row.tipo === "ajuste_stock";
}

// "De ayer + Producido - Vendido + Ajustes = Quedan" — Ajustes junta todo lo
// que mueve stock sin ser produccion ni venta (recuento, consumo, cierre de
// periodo, alta/baja manual — "Error de produccion" queda afuera, ver
// stockHistoricoPorFecha en business.js). Sin mostrar este numero aparte, un
// dia con un recuento de stock hace que la cuenta simple de Producido/Vendido
// no cierre con lo que se ve en pantalla, sin ninguna pista de por que.
function formatearAjuste(cantidad) {
  return cantidad > 0 ? `+${cantidad}` : String(cantidad);
}

async function renderCashier() {
  if (isModoConsulta()) {
    dom.salesLayout.style.display = "none";
    dom.cajaConsulta.hidden = false;
    dom.cajaConsulta.style.display = "";
    showConsultaPlaceholder(dom.cajaConsulta, "Cargando...");
    try {
      const catalogo = await catalogoConStockRemoto();
      renderStockConsulta(dom.cajaConsulta, catalogo.filter((p) => p.activo && p.controlaStock));
      markConsultaLoaded(dom.cajaConsulta);
    } catch (error) {
      dom.cajaConsulta.textContent = `No se pudo traer el stock: ${error.message || error}`;
    }
    return;
  }
  dom.salesLayout.style.display = "";
  dom.cajaConsulta.hidden = true;
  dom.cajaConsulta.style.display = "none";
  await loadProducts();
  renderReservedStock();
  renderCurrentCart();
}

async function renderProductionView() {
  if (isModoConsulta()) {
    dom.productionGroups.style.display = "none";
    dom.produccionConsulta.hidden = false;
    dom.produccionConsulta.style.display = "";
    // El cierre de periodo escribe en el IndexedDB local de ESTE dispositivo,
    // asi que solo tiene sentido en el que realmente opera — nunca en un
    // celular de consulta, que tiene su propia copia local vacia/vieja.
    dom.closePeriodButton.hidden = true;
    showConsultaPlaceholder(dom.produccionConsulta, "Cargando...");
    try {
      const fecha = todayISO();
      const [catalogo, movimientosRemotos, ventasRemotas] = await Promise.all([
        catalogoConStockRemoto(),
        fetchMovimientosStock(fecha),
        fetchVentasDelDia(fecha)
      ]);
      // "Producido hoy" sale de los mismos movimientos_stock que se listan
      // abajo (tipo "produccion"), nunca de produccion_diaria por separado —
      // mismo principio que productionSnapshot() en business.js, para que el
      // total y sus propias lineas nunca puedan desalinearse (ver incidente
      // del 19/09/2026).
      const producidoPorProducto = new Map();
      const movimientosPorProducto = new Map();
      for (const row of movimientosRemotos.filter(esMovimientoDeProduccion)) {
        const lista = movimientosPorProducto.get(row.producto_id) || [];
        lista.push({ tipo: row.tipo, motivo: row.motivo, cantidad: row.cantidad, creadoEn: row.creado_en });
        movimientosPorProducto.set(row.producto_id, lista);
        if (row.tipo === "produccion") {
          const cantidad = Number(row.cantidad) || 0;
          producidoPorProducto.set(row.producto_id, (producidoPorProducto.get(row.producto_id) || 0) + cantidad);
        }
      }
      const vendidoPorProducto = new Map();
      for (const venta of ventasRemotas) {
        for (const detalle of venta.detalle_venta || []) {
          vendidoPorProducto.set(
            detalle.producto_id,
            (vendidoPorProducto.get(detalle.producto_id) || 0) + (Number(detalle.cantidad) || 0)
          );
        }
      }
      const productosProduccion = catalogo
        .filter((p) => p.activo && p.controlaStock && (p.categoriaId === "sandwiches" || p.categoriaId === "bolleria"))
        .map((p) => {
          const cantidadProducida = producidoPorProducto.get(p.id) || 0;
          const vendido = vendidoPorProducto.get(p.id) || 0;
          return {
            ...p,
            cantidadProducida,
            movimientosProduccion: movimientosPorProducto.get(p.id) || [],
            cantidadAyer: (Number(p.stockActual) || 0) - cantidadProducida + vendido,
            vendidoHoy: vendido
          };
        });
      renderProduccionConsulta(dom.produccionConsulta, productosProduccion);
      markConsultaLoaded(dom.produccionConsulta);
    } catch (error) {
      dom.produccionConsulta.textContent = `No se pudo traer la produccion: ${error.message || error}`;
    }
    return;
  }
  dom.productionGroups.style.display = "";
  dom.produccionConsulta.hidden = true;
  dom.produccionConsulta.style.display = "none";
  dom.closePeriodButton.hidden = false;
  await loadProducts();
  const snapshot = await productionSnapshot();
  const historicoProduccion = await stockHistoricoPorFecha(snapshot.fecha);
  const conAyer = (lista) => lista.map((p) => ({ ...p, cantidadAyer: historicoProduccion.get(p.id)?.stockAlInicio ?? 0 }));
  snapshot.sandwiches = conAyer(snapshot.sandwiches);
  snapshot.bolleria = conAyer(snapshot.bolleria);
  snapshot.bebidas = conAyer(snapshot.bebidas);
  if (selectedProductionProductId && !snapshot.productionProducts.some((product) => product.id === selectedProductionProductId)) {
    selectedProductionProductId = "";
  }
  const totalSandwichesProduced = snapshot.sandwiches.reduce(
    (total, product) => total + (Number(product.cantidadProducida) || 0),
    0
  );
  dom.productionDateText.textContent = `Fecha: ${snapshot.fecha}. Total cargado en sandwiches: ${totalSandwichesProduced}. Toca un producto en sandwiches, bolleria o bebidas para sumar o restar stock.`;
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
      bolleria: dom.productionBolleriaList,
      bebidas: dom.productionBebidasList
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

  if (isModoConsulta()) {
    showConsultaPlaceholder(dom.historyList, "Cargando...");
    try {
      const { sales, snapshot, historico } = await datosRemotosDelDia(fecha);
      const totalSandwichesProduced = snapshot.sandwiches.reduce(
        (total, p) => total + (Number(p.cantidadProducida) || 0), 0
      );
      const sandwichIds = new Set(snapshot.sandwiches.map((p) => p.id));
      const totalSandwichesSold = sales.reduce(
        (total, sale) => total + sale.detalles.reduce(
          (saleTotal, detail) => saleTotal + (sandwichIds.has(detail.productoId) ? Number(detail.cantidad) || 0 : 0),
          0
        ),
        0
      );
      const totalSandwichesDisponibles = snapshot.sandwiches.reduce(
        (total, p) => total + (historico.get(p.id)?.stockAlFinal ?? (Number(p.stockActual) || 0)), 0
      );
      const totalStockAyer = snapshot.sandwiches.reduce(
        (total, p) => total + (historico.get(p.id)?.stockAlInicio ?? 0), 0
      );
      const totalAjustes = snapshot.sandwiches.reduce(
        (total, p) => total + (historico.get(p.id)?.ajuste ?? 0), 0
      );
      dom.historyProductionText.textContent = `De ayer: ${totalStockAyer} · Producidos hoy: ${totalSandwichesProduced} · Ajustes: ${formatearAjuste(totalAjustes)} · Vendidos: ${totalSandwichesSold} · Quedan: ${totalSandwichesDisponibles}`;
      renderHistory(dom.historyList, sales, {
        onShareSale: handleShareSale,
        onPrintSale: handlePrintSale
      });
      markConsultaLoaded(dom.historyList);
    } catch (error) {
      dom.historyList.textContent = `No se pudo traer el historial: ${error.message || error}`;
    }
    return;
  }

  dom.historialBackupPanel.style.display = "";
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
  const historico = await stockHistoricoPorFecha(fecha);
  const totalSandwichesDisponibles = snapshot.sandwiches.reduce(
    (total, product) => total + (historico.get(product.id)?.stockAlFinal ?? (Number(product.stockActual) || 0)),
    0
  );
  const totalStockAyer = snapshot.sandwiches.reduce(
    (total, product) => total + (historico.get(product.id)?.stockAlInicio ?? 0),
    0
  );
  const totalAjustes = snapshot.sandwiches.reduce(
    (total, product) => total + (historico.get(product.id)?.ajuste ?? 0),
    0
  );
  dom.historyProductionText.textContent = `De ayer: ${totalStockAyer} · Producidos hoy: ${totalSandwichesProduced} · Ajustes: ${formatearAjuste(totalAjustes)} · Vendidos: ${totalSandwichesSold} · Quedan: ${totalSandwichesDisponibles}`;
  renderHistory(dom.historyList, sales, {
    onUndoSale: handleUndoSale,
    onShareSale: handleShareSale,
    onPrintSale: handlePrintSale
  });
}

async function handleShareSale(sale) {
  const texto = formatVentaTicket(sale);
  const resultado = await shareText(texto.split("\n")[0], texto);
  if (resultado === "clipboard") {
    setFlash("El navegador no tiene para compartir directo: copiado al portapapeles.", "success");
  } else if (resultado === "unsupported") {
    setFlash("Este navegador no permite compartir ni copiar el ticket.", "error");
  }
}

function handlePrintSale(sale) {
  const texto = formatVentaTicket(sale);
  const abierto = printTicket(texto.split("\n")[0], texto);
  if (!abierto) {
    setFlash("El navegador bloqueo la ventana de impresion. Revisa el bloqueador de pop-ups.", "error");
  }
}

async function handleUndoSale(sale) {
  if (undoSaleInProgress) return;
  const confirmado = await confirmDialog({
    title: "Deshacer venta",
    message: `¿Deshacer ${saleTitleForConfirm(sale)}? Se va a reintegrar el stock vendido y la venta desaparece del historial. No se puede deshacer esta accion.`,
    acceptText: "Deshacer venta"
  });
  if (!confirmado) return;
  try {
    undoSaleInProgress = true;
    const { uuid, fecha, creadoEn, movimientosStock, movimientosInsumos } = await undoSale(sale.id);
    setFlash("Venta deshecha, stock reintegrado.", "success");
    trySyncVentaAnulada({ uuid, fecha, creadoEn }).catch(() => {});
    movimientosStock.forEach((m) => trySyncMovimientoStock(m).catch(() => {}));
    if (movimientosInsumos.length > 0) trySyncMovimientosInsumos(movimientosInsumos).catch(() => {});
    await renderHistoryView();
    await renderCashier();
  } catch (error) {
    setFlash(error.message || "No se pudo deshacer la venta.", "error");
  } finally {
    undoSaleInProgress = false;
  }
}

function saleTitleForConfirm(sale) {
  return sale.origen === "pedido" && sale.clienteNombre ? `el pedido de ${sale.clienteNombre}` : `la venta #${sale.id}`;
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
  provEditMode = "edit";
  selectedProvId = proveedor.id;
  dom.provEditTitle.textContent = "Editar proveedor";
  dom.provEditNombre.value = proveedor.nombre;
  dom.provEditTel.value = proveedor.tel ?? "";
  dom.provEditEmail.value = proveedor.email ?? "";
  dom.provEditNotas.value = proveedor.notas ?? "";
  dom.provEditDias.value = String(proveedor.diasCiclo ?? "");
  setProvEditSheetOpen(true);
  dom.provEditNombre.focus();
}

function openProvAdd() {
  provEditMode = "add";
  selectedProvId = "";
  dom.provEditTitle.textContent = "Agregar proveedor";
  dom.provEditNombre.value = "";
  dom.provEditTel.value = "";
  dom.provEditEmail.value = "";
  dom.provEditNotas.value = "";
  dom.provEditDias.value = "7";
  setProvEditSheetOpen(true);
  dom.provEditNombre.focus();
}

function closeProvEdit() {
  setProvEditSheetOpen(false);
  selectedProvId = "";
  provEditMode = "edit";
}

function renderProvProdRecetaRowsView() {
  renderProvProdRecetaRows(dom.provProdRecetaRows, provProdRecetaVinculos, provProdProductosDisponibles);
}

function limpiarProvProdNuevoInsumoFields() {
  dom.provProdNuevoNombre.value = "";
  dom.provProdNuevoUnidad.value = "";
  dom.provProdNuevoMin.value = "";
  dom.provProdNuevoCrit.value = "";
  provProdRecetaVinculos = [];
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
  limpiarProvProdNuevoInsumoFields();
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, "");
  provProdProductosDisponibles = await listProducts();
  renderProvProdRecetaRowsView();
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
  limpiarProvProdNuevoInsumoFields();
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, producto.insumoId ?? "");
  provProdProductosDisponibles = await listProducts();
  renderProvProdRecetaRowsView();
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
  const esNuevo = insumoId === "__nuevo__";
  dom.provProdNuevoInsumoFields.hidden = !esNuevo;
  if (!insumoId || esNuevo) {
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

async function handleDeleteProveedorInsumo(producto) {
  const confirmado = await confirmDialog({
    title: "Eliminar producto",
    message: `¿Eliminar "${producto.nombreProducto}" de este proveedor? El insumo vinculado no se borra, solo deja de venderselo este proveedor.`,
    acceptText: "Eliminar"
  });
  if (!confirmado) return;
  try {
    await deleteProveedorInsumo(producto.id);
    setFlash("Producto eliminado.", "success");
    await renderProveedoresView();
  } catch (error) {
    setFlash(error.message || "No se pudo eliminar.", "error");
  }
}

async function renderProveedoresView() {
  const data = await getProveedoresDashboardData();
  renderProveedoresList(dom.proveedoresList, data, {
    onEditProv: openProvEdit,
    onAddProd: openProvProdAdd,
    onEditProd: openProvProdEdit,
    onDeleteProd: handleDeleteProveedorInsumo
  });
}

function setMenuEditSheetOpen(isOpen) {
  menuEditSheetOpen = isOpen;
  dom.menuEditSheet.classList.toggle("open", isOpen);
  dom.menuEditSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.menuEditBackdrop.hidden = !isOpen;
  dom.menuEditBackdrop.classList.toggle("open", isOpen);
}

function renderMenuRecetaEditorView() {
  renderMenuRecetaRows(dom.menuRecetaRows, menuRecetaLineas, menuInsumosDisponibles, menuGruposVarianteDisponibles);
}

// Los inputs numericos son type="number", pero en la tablet a veces dejan
// pasar una coma decimal (normal en España) en vez de punto — parseFloat
// corta ahi y devuelve un numero mas chico o 0 sin avisar, tirando filas de
// receta enteras en silencio. Mismo parche que ya usa actualizarReceta() en
// aprovisionamiento.js para este mismo problema.
function parseDecimal(value) {
  return parseFloat(String(value ?? "").replace(",", "."));
}

// El tipo de sandwich (basico/premium) solo importa para la categoria
// sandwiches — es lo que usa pricing.js para sumar el recargo de +30
// centimos por unidad "de la casa" dentro de un combo (ver PREMIUM_SANDWICH_IDS
// e isPremiumSandwich en pricing.js).
function updateMenuTipoVisibility() {
  dom.menuEditTipoWrap.hidden = dom.menuEditCategoria.value !== "sandwiches";
}

function populateMenuVarianteSelect(selectedGrupoId) {
  dom.menuEditVariante.innerHTML =
    `<option value="">— Ninguna —</option>` +
    menuGruposVarianteDisponibles.map((g) => `<option value="${g.id}" ${g.id === selectedGrupoId ? "selected" : ""}>${g.nombre}</option>`).join("");
}

async function openMenuProductoAdd(categoriaId) {
  selectedMenuProductoId = "";
  menuProductoMode = "add";
  dom.menuEditTitle.textContent = "Agregar producto";
  dom.menuEditNombre.value = "";
  dom.menuEditPrecio.value = "";
  dom.menuEditControlaStock.checked = true;
  dom.menuEditUmbral.value = "10";
  dom.menuEditSandwichTipo.value = "basico";
  dom.menuEditActivo.checked = true;
  menuRecetaLineas = [];
  menuInsumosDisponibles = await listInsumos();
  menuGruposVarianteDisponibles = await getGruposVariantes();
  const categorias = await listCategories();
  dom.menuEditCategoria.innerHTML = categorias
    .map((c) => `<option value="${c.id}" ${c.id === categoriaId ? "selected" : ""}>${c.nombre}</option>`)
    .join("");
  populateMenuVarianteSelect("");
  updateMenuTipoVisibility();
  renderMenuRecetaEditorView();
  setMenuEditSheetOpen(true);
  dom.menuEditNombre.focus();
}

async function openMenuProductoEdit(producto) {
  selectedMenuProductoId = producto.id;
  menuProductoMode = "edit";
  dom.menuEditTitle.textContent = "Editar producto";
  dom.menuEditNombre.value = producto.nombre;
  dom.menuEditPrecio.value = (producto.precioCentavos / 100).toFixed(2);
  dom.menuEditControlaStock.checked = !!producto.controlaStock;
  dom.menuEditUmbral.value = String(producto.umbralBajo ?? 0);
  dom.menuEditSandwichTipo.value = producto.sandwichTipo === "premium" ? "premium" : "basico";
  dom.menuEditActivo.checked = !!producto.activo;
  menuInsumosDisponibles = await listInsumos();
  const [categorias, recetas, grupos, grupoActual] = await Promise.all([listCategories(), getAll("recetas"), getGruposVariantes(), getGrupoDeProducto(producto.id)]);
  menuGruposVarianteDisponibles = grupos;
  dom.menuEditCategoria.innerHTML = categorias
    .map((c) => `<option value="${c.id}" ${c.id === producto.categoriaId ? "selected" : ""}>${c.nombre}</option>`)
    .join("");
  populateMenuVarianteSelect(grupoActual?.id || "");
  updateMenuTipoVisibility();
  menuRecetaLineas = recetas
    .filter((r) => r.productoId === producto.id)
    .map((r) => ({
      insumoId: r.insumoId,
      cantidad: String(r.cantidadPorUnidad),
      nuevoNombre: "",
      nuevaUnidad: "",
      variantesCantidad: r.variantesCantidad ? { ...r.variantesCantidad } : {},
    }));
  renderMenuRecetaEditorView();
  setMenuEditSheetOpen(true);
  dom.menuEditNombre.focus();
}

function closeMenuEdit() {
  setMenuEditSheetOpen(false);
  selectedMenuProductoId = "";
  menuRecetaLineas = [];
}

async function handleToggleProductoActivo(producto) {
  try {
    await setProductoActivo(producto.id, !producto.activo);
    setFlash(producto.activo ? "Producto ocultado de caja." : "Producto visible en caja.", "success");
    await renderMenuView();
  } catch (error) {
    setFlash(error.message || "No se pudo actualizar.", "error");
  }
}

async function handleMoverProducto(id, direccion) {
  try {
    await moverProductoOrden(id, direccion);
    await renderMenuView();
  } catch (error) {
    setFlash(error.message || "No se pudo reordenar.", "error");
  }
}

async function renderMenuView() {
  const data = await getMenuDashboardData();
  renderMenuList(dom.menuList, data, {
    onAdd: openMenuProductoAdd,
    onEdit: openMenuProductoEdit,
    onToggleActivo: handleToggleProductoActivo,
    onMover: handleMoverProducto
  });
}

function renderVariantesOpcionesRowsView() {
  renderVariantesOpcionesRows(dom.varianteGrupoOpcionesRows, variantesOpcionesLineas, variantesInsumosDisponibles);
}

async function renderVariantesView() {
  const grupos = await getGruposVariantes();
  renderVariantesGruposList(dom.variantesGruposList, grupos, {
    onEdit: openVarianteGrupoEdit,
    onDelete: handleDeleteGrupoVariante
  });
}

function setVarianteGrupoSheetOpen(isOpen) {
  dom.varianteGrupoSheet.classList.toggle("open", isOpen);
  dom.varianteGrupoSheet.setAttribute("aria-hidden", isOpen ? "false" : "true");
  dom.varianteGrupoBackdrop.hidden = !isOpen;
  dom.varianteGrupoBackdrop.classList.toggle("open", isOpen);
}

async function openVarianteGrupoAdd() {
  grupoVarianteMode = "add";
  selectedGrupoVarianteId = "";
  dom.varianteGrupoTitle.textContent = "Agregar grupo de variante";
  dom.varianteGrupoNombre.value = "";
  dom.varianteGrupoTitulo.value = "";
  variantesOpcionesLineas = [];
  variantesInsumosDisponibles = await listInsumos();
  variantesProductosDisponibles = await listProducts();
  renderVariantesOpcionesRowsView();
  renderVariantesProductosChecklist(dom.varianteGrupoProductosChecklist, [], variantesProductosDisponibles);
  setVarianteGrupoSheetOpen(true);
  dom.varianteGrupoNombre.focus();
}

async function openVarianteGrupoEdit(grupo) {
  grupoVarianteMode = "edit";
  selectedGrupoVarianteId = grupo.id;
  dom.varianteGrupoTitle.textContent = "Editar grupo de variante";
  dom.varianteGrupoNombre.value = grupo.nombre;
  dom.varianteGrupoTitulo.value = grupo.titulo;
  variantesOpcionesLineas = grupo.opciones.map((o) => ({ nombre: o.nombre, insumoId: o.insumoId }));
  variantesInsumosDisponibles = await listInsumos();
  variantesProductosDisponibles = await listProducts();
  renderVariantesOpcionesRowsView();
  renderVariantesProductosChecklist(dom.varianteGrupoProductosChecklist, grupo.productoIds, variantesProductosDisponibles);
  setVarianteGrupoSheetOpen(true);
  dom.varianteGrupoNombre.focus();
}

function closeVarianteGrupoSheet() {
  setVarianteGrupoSheetOpen(false);
  selectedGrupoVarianteId = "";
}

async function handleDeleteGrupoVariante(grupo) {
  const confirmado = await confirmDialog({
    title: "Eliminar grupo de variante",
    message: `¿Eliminar "${grupo.nombre}"? Los productos asignados dejan de preguntar esta opción en caja.`,
    acceptText: "Eliminar"
  });
  if (!confirmado) return;
  try {
    await deleteGrupoVariante(grupo.id);
    await refreshGruposVariantes();
    setFlash("Grupo eliminado.", "success");
    await renderVariantesView();
  } catch (error) {
    setFlash(error.message || "No se pudo eliminar.", "error");
  }
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
      onMarcarEntregado: handleMarcarEntregado,
      onEditarPedido: openEditarPedidoSheet,
      onBorrarPedido: handleBorrarPedido,
      onCompartirPedido: handleCompartirPedido,
      expandedPedidoIds,
      onToggleItems: (pedidoId) => {
        if (expandedPedidoIds.has(pedidoId)) expandedPedidoIds.delete(pedidoId);
        else expandedPedidoIds.add(pedidoId);
      }
    });
  } catch (error) {
    dom.pedidosGrid.textContent = "No se pudo cargar los pedidos (revisa la conexion).";
    dom.pedidosGrid.classList.add("empty");
  }
}

// Productos que se pueden cargar en un pedido: los sandwiches (categoriaId
// "sandwiches" tambien incluye promos de combo como "Promo bebida" que no
// son sabores reales — esas no controlan stock, asi que se excluyen con
// controlaStock) mas un par de productos puntuales de bolleria que tambien
// se piden por encargo.
const PEDIDO_PRODUCT_IDS_EXTRA = new Set(["chipa", "medialunas"]);

function sandwichProductsForPedido() {
  return products.filter((p) =>
    p.activo && p.controlaStock && (p.categoriaId === "sandwiches" || PEDIDO_PRODUCT_IDS_EXTRA.has(p.id))
  );
}

// Mismo shape que espera calculateCartPricing (ver pricing.js): id,
// categoriaId, controlaStock, sandwichTipo, precioCentavos, quantity. El
// pedidoCart guarda un shape mas chico (productId/cantidad/precioUnitario)
// porque es lo que persiste pedidos.js — este mapeo es solo para calcular
// el precio en pantalla, no cambia lo que se guarda.
function pedidoCartPricingItems() {
  return Array.from(pedidoCart.values()).map((item) => {
    const product = products.find((p) => p.id === item.productId);
    return {
      id: item.productId,
      categoriaId: product?.categoriaId,
      controlaStock: product?.controlaStock,
      sandwichTipo: product?.sandwichTipo,
      precioCentavos: item.precioUnitarioCentavos,
      quantity: item.cantidad
    };
  });
}

function renderPedidoSheetContents() {
  renderPedidoProductPicker(dom.pedidoProductPicker, sandwichProductsForPedido(), pedidoCart, addToPedidoCart, decrementPedidoCartItem);
  dom.confirmPedido.disabled = pedidoCart.size === 0;
  // Docena/media docena se aplican automatico, igual que en Caja
  // (calculateCartPricing) — antes esto sumaba precio de catalogo sin combo,
  // asi que un pedido de 12 no bajaba a $34 solo hasta que alguien lo
  // corregia a mano.
  const pricing = calculateCartPricing(pedidoCartPricingItems());
  if (dom.pedidoComboHint) {
    if (pricing.combo) {
      dom.pedidoComboHint.textContent = `${pricing.combo.nombre} aplicado — ${(pricing.combo.precioCentavos / 100).toFixed(2)}€ en vez de ${(pricing.comboNormalCentavos / 100).toFixed(2)}€.`;
      dom.pedidoComboHint.hidden = false;
    } else {
      dom.pedidoComboHint.hidden = true;
    }
  }
  if (!pedidoPrecioEditadoManualmente) {
    dom.pedidoPrecioTotal.value = (pricing.totalCentavos / 100).toFixed(2);
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
  editingPedidoId = null;
  pedidoCart.clear();
  pedidoPrecioEditadoManualmente = false;
  dom.pedidoClienteNombre.value = "";
  dom.pedidoFechaRetiro.value = "";
  dom.pedidoHoraRetiro.value = "";
  dom.pedidoPrecioTotal.value = "";
  dom.pedidoPagado.checked = false;
  dom.pedidoCortadoMitad.checked = false;
  dom.pedidoAclaraciones.value = "";
  dom.pedidoSheetTitle.textContent = "Nuevo pedido";
  dom.confirmPedido.textContent = "Crear pedido";
  renderPedidoSheetContents();
  setPedidoSheetOpen(true);
}

// Reutiliza el mismo sheet de "Nuevo pedido", pre-llenado con los datos del
// pedido existente. Al guardar, handleCrearPedido detecta editingPedidoId y
// hace un update en vez de crear uno nuevo.
function openEditarPedidoSheet(pedido) {
  editingPedidoId = pedido.id;
  pedidoCart.clear();
  for (const item of pedido.items) {
    pedidoCart.set(item.productId, {
      productId: item.productId,
      nombre: item.nombre,
      cantidad: item.cantidad,
      precioUnitarioCentavos: item.precioUnitarioCentavos
    });
  }
  pedidoPrecioEditadoManualmente = true;
  dom.pedidoClienteNombre.value = pedido.clienteNombre;
  const retiro = new Date(pedido.fechaHoraRetiro);
  dom.pedidoFechaRetiro.value = `${retiro.getFullYear()}-${String(retiro.getMonth() + 1).padStart(2, "0")}-${String(retiro.getDate()).padStart(2, "0")}`;
  dom.pedidoHoraRetiro.value = `${String(retiro.getHours()).padStart(2, "0")}:${String(retiro.getMinutes()).padStart(2, "0")}`;
  dom.pedidoPrecioTotal.value = (pedido.totalCentavos / 100).toFixed(2);
  dom.pedidoPagado.checked = pedido.pagado;
  dom.pedidoCortadoMitad.checked = pedido.cortadoMitad;
  dom.pedidoAclaraciones.value = pedido.aclaraciones || "";
  dom.pedidoSheetTitle.textContent = "Editar pedido";
  dom.confirmPedido.textContent = "Guardar cambios";
  renderPedidoSheetContents();
  setPedidoSheetOpen(true);
}

function closePedidoSheet() {
  setPedidoSheetOpen(false);
  editingPedidoId = null;
}

async function handleCrearPedido(event) {
  event.preventDefault();
  if (pedidoCreateInProgress) return;
  try {
    pedidoCreateInProgress = true;
    if (pedidoCart.size === 0) throw new Error("Agrega al menos un producto al pedido.");
    if (!dom.pedidoFechaRetiro.value) throw new Error("Falta la fecha de retiro.");
    const horaRetiro = dom.pedidoHoraRetiro.value.trim();
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horaRetiro)) {
      throw new Error("La hora de retiro tiene que tener formato 24hs, ej: 21:00.");
    }
    const totalCentavos = Math.round(parseFloat(dom.pedidoPrecioTotal.value) * 100);
    const payload = {
      clienteNombre: dom.pedidoClienteNombre.value,
      fechaHoraRetiro: new Date(`${dom.pedidoFechaRetiro.value}T${horaRetiro}:00`).toISOString(),
      pagado: dom.pedidoPagado.checked,
      cortadoMitad: dom.pedidoCortadoMitad.checked,
      aclaraciones: dom.pedidoAclaraciones.value,
      totalCentavos,
      items: Array.from(pedidoCart.values())
    };
    if (editingPedidoId) {
      await editarPedido(editingPedidoId, payload);
      setFlash("Pedido actualizado.", "success");
    } else {
      await crearPedido(payload);
      setFlash("Pedido creado.", "success");
    }
    closePedidoSheet();
    await renderPedidosView();
  } catch (error) {
    setFlash(error.message || "No se pudo guardar el pedido.", "error");
  } finally {
    pedidoCreateInProgress = false;
  }
}

async function handleCompartirPedido(pedido) {
  const texto = formatPedidoTicket(pedido);
  const resultado = await shareText(`Pedido - ${pedido.clienteNombre}`, texto);
  if (resultado === "clipboard") {
    setFlash("El navegador no tiene para compartir directo: copiado al portapapeles.", "success");
  } else if (resultado === "unsupported") {
    setFlash("Este navegador no permite compartir ni copiar. Copialo a mano:\n" + texto, "error");
  }
}

async function handleBorrarPedido(pedido) {
  if (pedidoActionInProgress) return;
  const confirmado = await confirmDialog({
    title: "Borrar pedido",
    message: `¿Borrar el pedido de ${pedido.clienteNombre}? Esta accion no se puede deshacer.`,
    acceptText: "Borrar"
  });
  if (!confirmado) return;
  try {
    pedidoActionInProgress = true;
    await eliminarPedido(pedido.id);
    setFlash("Pedido borrado.", "success");
    await renderPedidosView();
  } catch (error) {
    setFlash(error.message || "No se pudo borrar el pedido.", "error");
  } finally {
    pedidoActionInProgress = false;
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
      unitOrders: item.unitOrders,
      opcionNombre: item.opcionNombre || null
    }));
    const sale = await confirmSale(items);
    cart.clear();
    resetVuelto();
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
  const { warnings, movimiento, movimientosInsumos } = await saveDailyProduction(productId, quantityRaw);
  dom.productionQuantity.value = "";
  if (warnings.length > 0) {
    setFlash(`Produccion guardada. ${warnings.join(" ")}`, "warning");
  } else {
    setFlash("Produccion guardada.", "success");
  }
  closeProductionSheet();
  trySyncMovimientoStock(movimiento).catch(() => {});
  if (movimientosInsumos.length > 0) trySyncMovimientosInsumos(movimientosInsumos).catch(() => {});
  await renderCashier();
}

// Uso puntual, una vez: pone en 0 el stock de todos los productos activos
// con control de stock, para arrancar un registro limpio desde una fecha de
// corte. Cada ajuste sale de este mismo dispositivo (el que realmente opera)
// con motivo "Cierre de periodo", asi que sincroniza igual que cualquier
// ajuste manual — no rompe nada de lo que ya esta congelado en el historial.
let closePeriodInProgress = false;

async function handleClosePeriod() {
  if (closePeriodInProgress) return;
  const confirmado = await confirmDialog({
    title: "Cerrar periodo",
    message: "Pone el stock de TODOS los productos en 0, motivo \"Cierre de periodo\". Es para arrancar un registro limpio desde hoy. El historial de ventas no se toca. ¿Continuar?",
    acceptText: "Poner todo en 0"
  });
  if (!confirmado) return;
  try {
    closePeriodInProgress = true;
    const productos = (await getAll("productos")).filter((p) => p.activo && p.controlaStock);
    let ajustados = 0;
    let yaEnCero = 0;
    for (const producto of productos) {
      if (Number(producto.stockActual) === 0) {
        yaEnCero++;
        continue;
      }
      const { movimiento } = await adjustStockLevel(producto.id, 0, "Cierre de periodo");
      trySyncMovimientoStock(movimiento).catch(() => {});
      ajustados++;
    }
    setFlash(`Cierre de periodo: ${ajustados} productos puestos en 0${yaEnCero > 0 ? `, ${yaEnCero} ya estaban en 0` : ""}.`, "success");
    await renderProductionView();
    await renderCashier();
  } catch (error) {
    setFlash(error.message || "No se pudo cerrar el periodo.", "error");
  } finally {
    closePeriodInProgress = false;
  }
}

function bindEvents() {
  dom.navLinks.forEach((link) => link.addEventListener("click", () => showView(link.dataset.view)));
  document.querySelectorAll(".sub-nav-link").forEach((link) => link.addEventListener("click", () => showGestionSubView(link.dataset.subview)));
  dom.closePeriodButton.addEventListener("click", handleClosePeriod);

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
    resetVuelto();
    renderCurrentCart();
  });
  dom.confirmSale.addEventListener("click", handleConfirmSale);
  dom.pagoCon.addEventListener("input", recalcularVuelto);
  dom.cartModeTogooToggle.addEventListener("change", () => {
    setCartMode(dom.cartModeTogooToggle.checked ? "togoo" : "normal");
  });
  dom.closeLeche.addEventListener("click", closeLecheSheet);
  dom.lecheBackdrop.addEventListener("click", closeLecheSheet);
  dom.lecheOpciones.addEventListener("click", (event) => {
    const boton = event.target.closest(".leche-opcion");
    if (boton) seleccionarOpcion(boton.dataset.opcion);
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
  dom.pedidoHoraRetiro.addEventListener("input", () => {
    const digitos = dom.pedidoHoraRetiro.value.replace(/\D/g, "").slice(0, 4);
    dom.pedidoHoraRetiro.value = digitos.length >= 3 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
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
      const { warnings, movimiento, movimientosInsumos } = await adjustStockLevel(product.id, newStock, dom.stockAdjustReason.value);
      if (warnings.length > 0) {
        setFlash(`Stock de ${product.nombre} ajustado a ${newStock}. ${warnings.join(" ")}`, "warning");
      } else {
        setFlash(`Stock de ${product.nombre} ajustado a ${newStock}.`, "success");
      }
      closeStockAdjustSheet();
      trySyncMovimientoStock(movimiento).catch(() => {});
      if (movimientosInsumos.length > 0) trySyncMovimientosInsumos(movimientosInsumos).catch(() => {});
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

  dom.historialRangoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (historialRangoInProgress) return;
    const submitBtn = dom.historialRangoForm.querySelector("button[type='submit']");
    try {
      historialRangoInProgress = true;
      submitBtn.disabled = true;
      submitBtn.textContent = "Generando ZIP...";
      const desde = dom.historialRangoDesde.value;
      const hasta = dom.historialRangoHasta.value;
      if (!desde || !hasta) throw new Error("Elegi las dos fechas del rango.");
      const dias = await exportSalesSummaryRange(desde, hasta);
      setFlash(`ZIP exportado con ${dias} día${dias === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setFlash(error.message || "No se pudo generar el ZIP.", "error");
    } finally {
      historialRangoInProgress = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "Descargar ZIP";
    }
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

  dom.abrirFactura.addEventListener("click", () => { openFacturaSheet().catch(() => {}); });
  dom.closeFactura.addEventListener("click", closeFacturaSheet);
  dom.facturaBackdrop.addEventListener("click", closeFacturaSheet);

  dom.abrirCrearInsumo.addEventListener("click", openCrearInsumoSheet);
  dom.closeCrearInsumo.addEventListener("click", closeCrearInsumoSheet);
  dom.crearInsumoBackdrop.addEventListener("click", closeCrearInsumoSheet);

  dom.crearInsumoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (crearInsumoInProgress) return;
    try {
      crearInsumoInProgress = true;
      await createInsumo({
        nombre: dom.crearInsumoNombre.value,
        unidad: dom.crearInsumoUnidad.value,
        stockMinimo: dom.crearInsumoMin.value,
        stockCritico: dom.crearInsumoCrit.value
      });
      setFlash("Insumo creado.", "success");
      closeCrearInsumoSheet();
      await renderInsumosView();
    } catch (error) {
      setFlash(error.message || "No se pudo crear el insumo.", "error");
    } finally {
      crearInsumoInProgress = false;
    }
  });
  dom.facturaProveedor.addEventListener("change", handleFacturaProveedorChange);
  dom.facturaProveedorNombre.addEventListener("input", actualizarFacturaContinuarDisabled);
  dom.facturaSacarFoto.addEventListener("click", () => dom.facturaInputFoto.click());
  dom.facturaAdjuntar.addEventListener("click", () => dom.facturaInputAdjunto.click());
  dom.facturaInputFoto.addEventListener("change", () => handleFacturaArchivoSeleccionado(dom.facturaInputFoto.files[0]));
  dom.facturaInputAdjunto.addEventListener("change", () => handleFacturaArchivoSeleccionado(dom.facturaInputAdjunto.files[0]));
  dom.facturaContinuar.addEventListener("click", handleFacturaLeer);
  dom.facturaConfirmar.addEventListener("click", handleFacturaConfirmar);

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

  dom.provAddNuevo.addEventListener("click", openProvAdd);
  dom.closeProvEdit.addEventListener("click", closeProvEdit);
  dom.provEditBackdrop.addEventListener("click", closeProvEdit);

  dom.closeProvProd.addEventListener("click", closeProvProd);
  dom.provProdBackdrop.addEventListener("click", closeProvProd);

  dom.provProdInsumo.addEventListener("change", updateProvProdCantidadLabel);

  dom.provProdAddRecetaRow.addEventListener("click", () => {
    provProdRecetaVinculos.push({ productoId: "", cantidad: "" });
    renderProvProdRecetaRowsView();
  });

  dom.provProdRecetaRows.addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (Number.isNaN(idx) || !provProdRecetaVinculos[idx]) return;
    if (e.target.classList.contains("prov-prod-receta-cantidad-input")) provProdRecetaVinculos[idx].cantidad = e.target.value;
  });

  dom.provProdRecetaRows.addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (Number.isNaN(idx) || !provProdRecetaVinculos[idx]) return;
    if (e.target.classList.contains("prov-prod-receta-producto-select")) provProdRecetaVinculos[idx].productoId = e.target.value;
  });

  dom.provProdRecetaRows.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="quitar-receta-row"]');
    if (!btn) return;
    provProdRecetaVinculos.splice(Number(btn.dataset.idx), 1);
    renderProvProdRecetaRowsView();
  });

  dom.provEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (provEditInProgress) return;
    if (provEditMode === "edit" && !selectedProvId) return;
    try {
      provEditInProgress = true;
      const nombre = dom.provEditNombre.value.trim();
      if (!nombre) throw new Error("El nombre no puede estar vacío.");
      const datos = {
        nombre,
        tel: dom.provEditTel.value.trim(),
        email: dom.provEditEmail.value.trim(),
        notas: dom.provEditNotas.value.trim(),
        diasCiclo: Number(dom.provEditDias.value) || 7
      };
      if (provEditMode === "add") {
        await createProveedor(datos);
      } else {
        await updateProveedor(selectedProvId, datos);
      }
      setFlash(provEditMode === "add" ? "Proveedor agregado." : "Proveedor actualizado.", "success");
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
      const precio = parseDecimal(dom.provProdPrecio.value);
      if (!nombre) throw new Error("El nombre del producto es obligatorio.");
      if (!unidad) throw new Error("La unidad de compra es obligatoria.");
      if (isNaN(precio) || precio < 0) throw new Error("Ingresa un precio válido.");
      const insumoId = dom.provProdInsumo.value || null;
      const cantidad = parseDecimal(dom.provProdCantidad.value) || 1;
      const esInsumoNuevo = insumoId === "__nuevo__";
      await saveProveedorInsumo({
        id: provProdMode === "edit" ? selectedProvProdId : undefined,
        proveedorId: selectedProvId,
        insumoId,
        nombreProducto: nombre,
        unidadCompra: unidad,
        cantidadPorUnidad: cantidad,
        precioUnitarioCentavos: Math.round(precio * 100),
        ...(esInsumoNuevo ? {
          nuevoInsumo: {
            nombre: dom.provProdNuevoNombre.value,
            unidad: dom.provProdNuevoUnidad.value,
            stockMinimo: dom.provProdNuevoMin.value,
            stockCritico: dom.provProdNuevoCrit.value
          },
          recetasVinculadas: provProdRecetaVinculos
        } : {})
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

  dom.closeMenuEdit.addEventListener("click", closeMenuEdit);
  dom.menuEditBackdrop.addEventListener("click", closeMenuEdit);
  dom.menuEditCategoria.addEventListener("change", updateMenuTipoVisibility);

  dom.menuAddRecetaRow.addEventListener("click", () => {
    menuRecetaLineas.push({ insumoId: "", cantidad: "", nuevoNombre: "", nuevaUnidad: "" });
    renderMenuRecetaEditorView();
  });

  dom.menuRecetaRows.addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (Number.isNaN(idx) || !menuRecetaLineas[idx]) return;
    if (e.target.classList.contains("menu-receta-cantidad")) menuRecetaLineas[idx].cantidad = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-nombre")) menuRecetaLineas[idx].nuevoNombre = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-unidad")) menuRecetaLineas[idx].nuevaUnidad = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-min")) menuRecetaLineas[idx].nuevoStockMinimo = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-critico")) menuRecetaLineas[idx].nuevoStockCritico = e.target.value;
    if (e.target.classList.contains("menu-receta-variante-cantidad")) {
      const opcion = e.target.dataset.opcion;
      if (!menuRecetaLineas[idx].variantesCantidad) menuRecetaLineas[idx].variantesCantidad = {};
      if (e.target.value === "") {
        delete menuRecetaLineas[idx].variantesCantidad[opcion];
      } else {
        menuRecetaLineas[idx].variantesCantidad[opcion] = e.target.value;
      }
    }
  });

  dom.menuRecetaRows.addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.idx);
    if (Number.isNaN(idx) || !menuRecetaLineas[idx]) return;
    if (e.target.classList.contains("menu-receta-insumo")) {
      menuRecetaLineas[idx].insumoId = e.target.value;
      renderMenuRecetaEditorView();
    }
  });

  dom.menuRecetaRows.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="quitar-linea"]');
    if (!btn) return;
    menuRecetaLineas.splice(Number(btn.dataset.idx), 1);
    renderMenuRecetaEditorView();
  });

  dom.varianteAddGrupo.addEventListener("click", () => { openVarianteGrupoAdd().catch(() => {}); });
  dom.closeVarianteGrupo.addEventListener("click", closeVarianteGrupoSheet);
  dom.varianteGrupoBackdrop.addEventListener("click", closeVarianteGrupoSheet);

  dom.varianteGrupoAddOpcion.addEventListener("click", () => {
    variantesOpcionesLineas.push({ nombre: "", insumoId: "", nuevoInsumo: {} });
    renderVariantesOpcionesRowsView();
  });

  dom.varianteGrupoOpcionesRows.addEventListener("input", (e) => {
    const idx = Number(e.target.dataset.idx);
    const linea = variantesOpcionesLineas[idx];
    if (Number.isNaN(idx) || !linea) return;
    if (e.target.classList.contains("variante-opcion-nombre")) linea.nombre = e.target.value;
    if (e.target.classList.contains("variante-nuevo-nombre")) linea.nuevoInsumo = { ...linea.nuevoInsumo, nombre: e.target.value };
    if (e.target.classList.contains("variante-nuevo-unidad")) linea.nuevoInsumo = { ...linea.nuevoInsumo, unidad: e.target.value };
    if (e.target.classList.contains("variante-nuevo-min")) linea.nuevoInsumo = { ...linea.nuevoInsumo, stockMinimo: e.target.value };
    if (e.target.classList.contains("variante-nuevo-crit")) linea.nuevoInsumo = { ...linea.nuevoInsumo, stockCritico: e.target.value };
  });

  dom.varianteGrupoOpcionesRows.addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.idx);
    const linea = variantesOpcionesLineas[idx];
    if (Number.isNaN(idx) || !linea) return;
    if (e.target.classList.contains("variante-opcion-insumo")) {
      linea.insumoId = e.target.value;
      renderVariantesOpcionesRowsView();
    }
  });

  dom.varianteGrupoOpcionesRows.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="quitar-variante"]');
    if (!btn) return;
    variantesOpcionesLineas.splice(Number(btn.dataset.idx), 1);
    renderVariantesOpcionesRowsView();
  });

  dom.varianteGrupoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (variantesFormInProgress) return;
    try {
      variantesFormInProgress = true;
      const opciones = variantesOpcionesLineas.filter((l) => l.nombre?.trim() && (l.insumoId === "__nuevo__" ? l.nuevoInsumo?.nombre?.trim() : l.insumoId));
      const productoIds = Array.from(dom.varianteGrupoProductosChecklist.querySelectorAll(".variante-producto-check:checked")).map((el) => el.value);
      await saveGrupoVariante({
        id: grupoVarianteMode === "edit" ? selectedGrupoVarianteId : undefined,
        nombre: dom.varianteGrupoNombre.value,
        titulo: dom.varianteGrupoTitulo.value,
        opciones,
        productoIds
      });
      await refreshGruposVariantes();
      setFlash(grupoVarianteMode === "edit" ? "Grupo actualizado." : "Grupo agregado.", "success");
      closeVarianteGrupoSheet();
      await renderVariantesView();
      await renderInsumosView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      variantesFormInProgress = false;
    }
  });

  dom.menuEditForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (menuEditInProgress) return;
    try {
      menuEditInProgress = true;
      const nombre = dom.menuEditNombre.value.trim();
      const categoriaId = dom.menuEditCategoria.value;
      const precio = parseDecimal(dom.menuEditPrecio.value);
      if (!nombre) throw new Error("El nombre es obligatorio.");
      if (!categoriaId) throw new Error("Elegi una categoria.");
      if (isNaN(precio) || precio < 0) throw new Error("Ingresa un precio válido.");
      const lineasReceta = menuRecetaLineas
        .filter((l) => (l.insumoId === "__nuevo__" ? l.nuevoNombre?.trim() : l.insumoId) && parseDecimal(l.cantidad) > 0)
        .map((l) => ({ ...l, cantidad: parseDecimal(l.cantidad) }));
      const productoGuardado = await saveProducto({
        id: menuProductoMode === "edit" ? selectedMenuProductoId : undefined,
        categoriaId,
        nombre,
        precioCentavos: Math.round(precio * 100),
        controlaStock: dom.menuEditControlaStock.checked,
        umbralBajo: parseDecimal(dom.menuEditUmbral.value) || 0,
        sandwichTipo: categoriaId === "sandwiches" ? dom.menuEditSandwichTipo.value : undefined,
        activo: dom.menuEditActivo.checked,
        lineasReceta
      });
      await setProductoGrupoVariante(productoGuardado.id, dom.menuEditVariante.value || null);
      await refreshGruposVariantes();
      setFlash(menuProductoMode === "edit" ? "Producto actualizado." : "Producto agregado.", "success");
      closeMenuEdit();
      await renderMenuView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      menuEditInProgress = false;
    }
  });

  dom.refrescarCatalogo.addEventListener("click", async () => {
    if (refrescarCatalogoInProgress) return;
    refrescarCatalogoInProgress = true;
    setRefrescarCatalogoEstado("loading");
    try {
      const resultado = await pullCatalogoCompleto();
      await refreshGestionSubView(currentGestionSubView);
      setRefrescarCatalogoEstado(
        "success",
        `Catalogo actualizado: ${resultado.catalogo.productos} productos, ${resultado.insumosCount} insumos, ${resultado.proveedoresResult.proveedores} proveedores` +
        (resultado.stockResult.insumosActualizados > 0 ? `, stock actualizado en ${resultado.stockResult.insumosActualizados} insumo${resultado.stockResult.insumosActualizados === 1 ? "" : "s"}` : "") +
        (resultado.stockProductosResult.productosActualizados > 0 ? `, stock actualizado en ${resultado.stockProductosResult.productosActualizados} producto${resultado.stockProductosResult.productosActualizados === 1 ? "" : "s"}` : "") +
        (resultado.variantesResult.aplicado ? `, ${resultado.variantesResult.grupos} grupo${resultado.variantesResult.grupos === 1 ? "" : "s"} de variante` : "") +
        "."
      );
    } catch (error) {
      setRefrescarCatalogoEstado("error", error.message || "No se pudo actualizar el catalogo (revisa la conexion).");
    } finally {
      refrescarCatalogoInProgress = false;
    }
  });

  window.addEventListener("hashchange", () => {
    const viewName = window.location.hash.replace("#", "") || "caja";
    if (["caja", "pedidos", "produccion", "historial", "gestion"].includes(viewName)) showView(viewName);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPedidosPolling();
      stopConsultaPolling();
      return;
    }
    if (currentView === "pedidos") startPedidosPolling();
    if (isModoConsulta() && CONSULTA_VIEWS.includes(currentView)) startConsultaPolling();
    refreshView();
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
  await initModoConsultaDefault();
  await refreshGruposVariantes();
  setupAutoSync();
  setupSyncBadge();
  // Subir insumos, recetas, proveedores y proveedor_insumos a Supabase al
  // arrancar (upsert idempotente) — la lectura de facturas necesita esto del
  // lado del servidor, no solo la tablet lo usa mas.
  Promise.all([getAll("insumos"), getAll("recetas"), getAll("proveedores"), getAll("proveedor_insumos")])
    .then(([insumos, recetas, proveedores, proveedorInsumos]) => {
      trySyncInsumosSnapshot(insumos).catch(() => {});
      trySyncRecetasSnapshot(recetas).catch(() => {});
      trySyncProveedoresSnapshot(proveedores).catch(() => {});
      trySyncProveedorInsumosSnapshot(proveedorInsumos).catch(() => {});
    }).catch(() => {});
  // Catalogo (categorias/productos): ademas de lo que trae el seed, se edita
  // desde Gestion > Menu (ver menu.js) y se espeja a Supabase al arrancar
  // para que el dashboard lea el real en vez de mantener su propia copia.
  Promise.all([getAll("categorias"), getAll("productos")])
    .then(([categorias, productos]) => {
      trySyncCatalogoSnapshot(categorias, productos).catch(() => {});
    }).catch(() => {});
  // Auto-sync silencioso al abrir la app (ver sincronizarCatalogoSilencioso).
  // Sin await a proposito: no puede demorar el primer render (offline-first).
  // El carrito de Caja siempre arranca vacio en este momento, asi que no
  // existe el riesgo de precio-visto-vs-precio-cobrado que si aplicaria si
  // esto corriera con una venta ya empezada.
  if (!isModoConsulta()) sincronizarCatalogoSilencioso();
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
