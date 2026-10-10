import { exportSalesSummary, exportDailySummaryJSON, exportSalesSummaryRange, buildSalesSummaryText, exportFullBackup } from "../modules/backup.js";
import { cargarPanel } from "../modules/panel.js";
import { cargarCierre, guardarCierre } from "../modules/cierre.js";
import { renderCierre, calcularDesdeFormulario } from "../ui/render-cierre.js";
import { abrirCaja, aperturaDelDia, anotarPago, anotarRetiro, anularMovimiento, movimientosDelDia, totalesDelDia, fotoDelCajon } from "../modules/caja-dia.js";
import { renderPasoApertura, renderPasoPagos, renderPasoRetiros } from "../ui/render-caja-pasos.js";
import { renderPanel } from "../ui/render-panel.js";
import { sumarDias } from "../modules/panel-calculos.js";
import { signIn, signOut, restoreSession, fetchStockProductos } from "../db/supabase.js";
import { seedInsumos, listInsumos, ajustarStockInsumo, calibrarInsumo, listaDeComprasSmart, exportarListaCompras, getCalibracionDashboardData, getRecetasDashboardData, actualizarReceta, saveInsumoCalibrationSettings, previewProduccionInsumos, pullInsumosDesdeNube, createInsumo, crearLineaReceta, eliminarLineaReceta, descartarInsumo, reconciliarStockInsumosConNube, normalizarEnvasesInsumos, limpiarCatalogoV12, limpiarCatalogoV13, limpiarCatalogoV14, activarSetCompletoDePrueba, afinarCatalogoDePrueba } from "../modules/aprovisionamiento.js";
import { seedProveedores, getProveedoresDashboardData, updateProveedor, createProveedor, saveProveedorInsumo, deleteProveedorInsumo, pullProveedoresDesdeNube } from "../modules/proveedores.js";
import { renderProveedoresList, renderProvProdInsumoSelect, renderProvProdRecetaRows, aplicarProvProdRecetaSeleccion } from "../ui/render-proveedores.js";
import { getMenuDashboardData, saveProducto, setProductoActivo, moverProductoOrden, reordenarProductos, pullCatalogoDesdeNube, verificarEliminacionProducto, mensajeBloqueoEliminacion, eliminarProducto } from "../modules/menu.js";
import { habilitarArrastre } from "../ui/arrastrar-filas.js";
import { revisarCicloInsumos, pendientesDelCiclo, resumenPendientes } from "../modules/ciclo-insumos.js";
import { renderPendientesCiclo, leerPendiente } from "../ui/render-ciclo.js";
import { cargarCombosConfigLocal, getCombosConfigActual, guardarCombosConfig, pullCombosConfigDesdeNube } from "../modules/combos.js";
import { revisarNovedades, marcarNovedadesTraidas, inicializarNovedadesSiHaceFalta } from "../modules/novedades.js";
import { resumenDelDia as resumenPedidosDelDia, pedidosPorEntregar, textoPorEntregar } from "../modules/avisos-pedidos.js";
import { unidadesDisponibles, tieneConversion, aBase, desdeBase, mejorUnidad, formatearCantidad, formatearConEnvase, etiquetaUnidad, formatearNumero, paraInput } from "../utils/unidades.js";
import { getGruposVariantes, saveGrupoVariante, deleteGrupoVariante, getGrupoDeProducto, setProductoGrupoVariante, pullVariantesGruposDesdeNube } from "../modules/variantes.js";
import { renderVariantesOpcionesRows, renderVariantesProductosChecklist, renderVariantesGruposList } from "../ui/render-variantes.js";
import { mensajeConfirmacionEliminacion } from "../modules/menu-calculos.js";
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
  getPendingVentaUuids,
  getSyncStatus,
  subscribeSyncStatus,
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
  reconciliarStockProductosConNube,
  TOGOO_FLAT_TOTAL_CENTAVOS,
  datosRemotosDelDia
} from "../modules/business.js";
import { seedDatabase, getAll } from "../db/idb.js";
import { todayISO, centsToMoney, slugify, avanzarFechaSimulada } from "../utils/format.js";
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
let formaPagoActual = "efectivo"; // "efectivo" | "tarjeta" — se pide al cobrar, se resetea a efectivo (la mas comun) despues de cada venta.
let productionInProgress = false;
let productionCommentInProgress = false;
let stockAdjustInProgress = false;
let cartOrder = 0;
let selectedProductionProductId = "";
let productionSheetOpen = false;
let insumoWarningSheetOpen = false;
let pendingProduction = null;
// Cola de insumos faltantes por cargar, uno atras del otro (ver
// dom.insumoWarningUpdate y el submit de insumosAjusteForm mas abajo).
let colaFaltantesInsumos = [];
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
// recetas, insumos (definicion), proveedores, grupos de variante, y el stock
// en vivo de insumos y productos. El stock NO se fusiona ni se suma: la nube
// lo deriva de los movimientos y es la verdad; este dispositivo alinea su
// copia local con ella (ver reconciliarStock*ConNube), pero solo cuando no
// tiene nada pendiente de subir — por eso primero se drena la cola. Un solo
// punto para el boton manual Y para el auto-sync silencioso (ver
// sincronizarCatalogoSilencioso), asi nunca se desalinean.
async function pullCatalogoCompleto() {
  // PRIMERO subir lo propio, DESPUES bajar lo de los demas. Al reves, un
  // cambio hecho sin internet (ej. un precio nuevo todavia en la cola) se
  // pisaba con el valor viejo de la nube antes de haber llegado a subir, y
  // el cambio se perdia sin aviso.
  await processSyncQueue().catch(() => {});
  const [catalogo, insumosCount, proveedoresResult, variantesResult] = await Promise.all([
    pullCatalogoDesdeNube(),
    pullInsumosDesdeNube(),
    pullProveedoresDesdeNube(),
    pullVariantesGruposDesdeNube(),
    pullCombosConfigDesdeNube()
  ]);
  // Antes de reconciliar el stock: corrige envases mal puestos (una sola vez)
  // sobre lo que acabo de bajar la nube, porque algunos insumos no vienen del
  // seed y recien existen aca despues del pull.
  await normalizarEnvasesInsumos().catch(() => ({ corregidos: [] }));
  const [stockInsumos, stockProductos] = await Promise.all([
    reconciliarStockInsumosConNube(),
    reconciliarStockProductosConNube()
  ]);

  // DESPUES de reconciliar, no antes. La limpieza encola subidas del catalogo,
  // y reconciliarStock*ConNube arranca con un return si hay algo pendiente en
  // la cola: puesta antes, se saltaba la reconciliacion entera en el primer
  // arranque y el stock local quedaba viejo. Es la misma cascada que corrompio
  // stock el 05/10, encontrada esta vez por la prueba en vez de por el dueño.
  await limpiarCatalogoV12().catch(() => ({ cambios: 0 }));
  await limpiarCatalogoV13().catch(() => ({ cambios: 0 }));
  await limpiarCatalogoV14().catch(() => ({ cambios: 0 }));
  await activarSetCompletoDePrueba().catch(() => ({ cambios: 0 }));
  await afinarCatalogoDePrueba().catch(() => ({ cambios: 0 }));
  await refreshGruposVariantes();
  await loadProducts();
  return { catalogo, insumosCount, proveedoresResult, variantesResult, stockInsumos, stockProductos };
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
    setRefrescarCatalogoTextoNovedades();
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
let recetaEditUnidadBase = "g";
let recetaEditEnvase = null;
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
// productoId -> texto de la cantidad que ese producto ya lleva de este
// insumo ("25 ml"). Se usa al editar: esas lineas ya existen, no se vuelven
// a crear y el campo unico de cantidad no las pisa.
let provProdRecetaYaEnReceta = new Map();
let insumoRecetaCargado = null;
let provProdProductosDisponibles = [];
let provEditSheetOpen = false;
let provProdSheetOpen = false;
let menuEditInProgress = false;
let refrescarCatalogoInProgress = false;
let historialRangoInProgress = false;
let selectedMenuProductoId = "";
let menuProductoMode = "add";
let menuEditSheetOpen = false;
let menuProductoEditando = null;
let menuEliminarInProgress = false;
let menuRecetaLineas = [];
let menuInsumosDisponibles = [];
let menuProveedoresDisponibles = [];
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
  offlineBanner: document.querySelector("#offline-banner"),
  novedadesBadge: document.querySelector("#novedades-badge"),
  avisoPedidos: document.querySelector("#aviso-pedidos"),
  avisoPedidosTexto: document.querySelector("#aviso-pedidos-texto"),
  avisoPedidosVer: document.querySelector("#aviso-pedidos-ver"),
  avisoPedidosCerrar: document.querySelector("#aviso-pedidos-cerrar"),
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
  pagoFormaEfectivo: document.querySelector("#pago-forma-efectivo"),
  pagoFormaTarjeta: document.querySelector("#pago-forma-tarjeta"),
  cartVuelto: document.querySelector("#cart-vuelto"),
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
  insumosOrden: document.querySelector("#insumos-orden"),
  refrescarCatalogo: document.querySelector("#refrescar-catalogo"),
  refrescarCatalogoStatus: document.querySelector("#refrescar-catalogo-status"),
  relojSimulado: document.querySelector("#reloj-simulado"),
  relojSimuladoFecha: document.querySelector("#reloj-simulado-fecha"),
  relojSimuladoAvanzar: document.querySelector("#reloj-simulado-avanzar"),
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
  cierreRoot: document.querySelector("#cierre-root"),
  cierreDate: document.querySelector("#cierre-date"),
  cierrePrev: document.querySelector("#cierre-prev"),
  cierreNext: document.querySelector("#cierre-next"),
  cierreHoy: document.querySelector("#cierre-hoy"),
  panelRoot: document.querySelector("#panel-root"),
  panelDate: document.querySelector("#panel-date"),
  panelPrev: document.querySelector("#panel-prev"),
  panelNext: document.querySelector("#panel-next"),
  panelHoy: document.querySelector("#panel-hoy"),
  panelRefresh: document.querySelector("#panel-refresh"),
  historyProductionText: document.querySelector("#history-production-text"),
  historyList: document.querySelector("#history-list"),
  exportSalesSummary: document.querySelector("#export-sales-summary"),
  resumenPreview: document.querySelector("#resumen-preview"),
  resumenPreviewText: document.querySelector("#resumen-preview-text"),
  resumenPreviewDownload: document.querySelector("#resumen-preview-download"),
  resumenPreviewClose: document.querySelector("#resumen-preview-close"),
  exportSalesJson: document.querySelector("#export-sales-json"),
  exportBackupCompleto: document.querySelector("#export-backup-completo"),
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
  insumosCompraEquivale: document.querySelector("#insumos-compra-equivale"),
  insumosAjusteInstruccion: document.querySelector("#insumos-ajuste-instruccion"),
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
  calibracionUnidad: document.querySelector("#calibracion-unidad"),
  calibracionEquivale: document.querySelector("#calibracion-equivale"),
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
  recetaEditUnidad: document.querySelector("#receta-edit-unidad"),
  recetaEditEquivale: document.querySelector("#receta-edit-equivale"),
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
  crearInsumoEnvase: document.querySelector("#crear-insumo-envase"),
  crearInsumoEnvaseTrae: document.querySelector("#crear-insumo-envase-trae"),
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
  provEditLead: document.querySelector("#prov-edit-lead"),
  cajaPasoApertura: document.querySelector("#caja-paso-apertura"),
  cajaPasoPagos: document.querySelector("#caja-paso-pagos"),
  cajaPasoRetiros: document.querySelector("#caja-paso-retiros"),
  cajaPagoSheet: document.querySelector("#caja-pago-sheet"),
  cajaPagoBackdrop: document.querySelector("#caja-pago-backdrop"),
  cajaPagoForm: document.querySelector("#caja-pago-form"),
  cajaPagoImporte: document.querySelector("#caja-pago-importe"),
  cajaPagoConcepto: document.querySelector("#caja-pago-concepto"),
  cajaPagoQuien: document.querySelector("#caja-pago-quien"),
  cajaPagoProveedores: document.querySelector("#caja-pago-proveedores"),
  cajaPagoForma: document.querySelector("#caja-pago-forma"),
  closeCajaPago: document.querySelector("#close-caja-pago"),
  cajaRetiroSheet: document.querySelector("#caja-retiro-sheet"),
  cajaRetiroBackdrop: document.querySelector("#caja-retiro-backdrop"),
  cajaRetiroForm: document.querySelector("#caja-retiro-form"),
  cajaRetiroImporte: document.querySelector("#caja-retiro-importe"),
  cajaRetiroMotivo: document.querySelector("#caja-retiro-motivo"),
  cajaRetiroCuenta: document.querySelector("#caja-retiro-cuenta"),
  cajaRetiroQueda: document.querySelector("#caja-retiro-queda"),
  closeCajaRetiro: document.querySelector("#close-caja-retiro"),
  provEditEntrega: document.querySelector("#prov-edit-entrega"),
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
  provProdCantidadLabel: document.querySelector("#prov-prod-cantidad-label"),
  provProdCantidadAyuda: document.querySelector("#prov-prod-cantidad-ayuda"),
  provProdRecetaSection: document.querySelector("#prov-prod-receta-section"),
  provProdRecetaCantidad: document.querySelector("#prov-prod-receta-cantidad"),
  provProdRecetaCantidadUnidad: document.querySelector("#prov-prod-receta-cantidad-unidad"),
  provProdRecetaAyuda: document.querySelector("#prov-prod-receta-ayuda"),
  provProdCantidad: document.querySelector("#prov-prod-cantidad"),
  provProdPrecio: document.querySelector("#prov-prod-precio"),
  menuList: document.querySelector("#menu-list"),
  menuEditSheet: document.querySelector("#menu-edit-sheet"),
  menuEditBackdrop: document.querySelector("#menu-edit-backdrop"),
  closeMenuEdit: document.querySelector("#close-menu-edit"),
  menuEditForm: document.querySelector("#menu-edit-form"),
  menuEditEliminar: document.querySelector("#menu-edit-eliminar"),
  menuEditEliminarWrap: document.querySelector("#menu-edit-eliminar-wrap"),
  menuEditTitle: document.querySelector("#menu-edit-title"),
  menuEditNombre: document.querySelector("#menu-edit-nombre"),
  menuEditCategoria: document.querySelector("#menu-edit-categoria"),
  menuEditPrecio: document.querySelector("#menu-edit-precio"),
  menuComboDocena: document.querySelector("#menu-combo-docena"),
  menuComboMedia: document.querySelector("#menu-combo-media"),
  menuComboPremium: document.querySelector("#menu-combo-premium"),
  menuCombosGuardar: document.querySelector("#menu-combos-guardar"),
  irARecetas: document.querySelector("#ir-a-recetas"),
  irAInsumosDesdeVariantes: document.querySelector("#ir-a-insumos-desde-variantes"),
  menuCombosStatus: document.querySelector("#menu-combos-status"),
  avisoCiclo: document.querySelector("#aviso-ciclo"),
  seccionCalibracion: document.querySelector("#seccion-calibracion"),
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

// --- Avisos de pedidos ---
//
// Dos avisos, los dos dentro de la app (sin permisos ni notificaciones del
// sistema): el resumen del dia la primera vez que se abre, y "falta una hora"
// antes de cada entrega. Se revisa cada 5 minutos: la ventana de aviso es de
// una hora, asi que no hace falta mas seguido.
const AVISO_PEDIDOS_CADA_MS = 5 * 60 * 1000;
let avisoPedidosTimer = null;
let resumenDiaMostrado = null;      // fecha del dia cuyo resumen ya se mostro
const pedidosYaAvisados = new Set(); // ids avisados de "falta una hora"

function mostrarAvisoPedidos(texto) {
  if (!dom.avisoPedidos) return;
  dom.avisoPedidosTexto.textContent = texto;
  dom.avisoPedidos.hidden = false;
}

function ocultarAvisoPedidos() {
  if (dom.avisoPedidos) dom.avisoPedidos.hidden = true;
}

async function revisarAvisosPedidos() {
  if (document.hidden) return;
  let pedidos;
  try {
    pedidos = await fetchPedidosDelDia();
  } catch {
    return; // sin conexion no se avisa nada; se reintenta en la proxima vuelta
  }
  const hoy = todayISO();

  // 1) Lo mas urgente primero: una entrega dentro de la proxima hora.
  const porEntregar = pedidosPorEntregar(pedidos, new Date(), pedidosYaAvisados);
  if (porEntregar.length > 0) {
    const proximo = porEntregar[0];
    pedidosYaAvisados.add(String(proximo.id));
    mostrarAvisoPedidos(textoPorEntregar(proximo));
    return;
  }

  // 2) Y si no hay nada inminente, el resumen del dia (una vez por dia).
  if (resumenDiaMostrado !== hoy) {
    resumenDiaMostrado = hoy;
    const resumen = resumenPedidosDelDia(pedidos, hoy);
    if (resumen) mostrarAvisoPedidos(resumen.texto);
  }
}

function setupAvisosPedidos() {
  dom.avisoPedidosCerrar?.addEventListener("click", ocultarAvisoPedidos);
  dom.avisoPedidosVer?.addEventListener("click", () => {
    ocultarAvisoPedidos();
    showView("pedidos");
  });
  if (avisoPedidosTimer) window.clearInterval(avisoPedidosTimer);
  avisoPedidosTimer = window.setInterval(revisarAvisosPedidos, AVISO_PEDIDOS_CADA_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revisarAvisosPedidos();
  });
}

// --- Cambios ENTRANTES (lo que hizo otro dispositivo y falta bajar) ---
//
// Es el espejo del badge de sincronizacion: aquel cuenta lo que falta SUBIR,
// este lo que falta BAJAR. No baja nada solo a proposito — en la tablet el
// catalogo no puede cambiar a mitad de una venta (ver
// sincronizarCatalogoSilencioso). Solo avisa; traerlo es un toque.
let novedadesUltimo = { total: 0, texto: "", cursoresNuevos: null };
let novedadesTimer = null;
let novedadesEnCurso = false;

function renderNovedadesBadge() {
  if (!dom.novedadesBadge) return;
  if (novedadesUltimo.total === 0) {
    dom.novedadesBadge.hidden = true;
    return;
  }
  dom.novedadesBadge.hidden = false;
  dom.novedadesBadge.textContent = `⬇ ${novedadesUltimo.texto}`;
}

async function revisarNovedadesAhora() {
  if (novedadesEnCurso || !navigator.onLine || document.hidden) return;
  novedadesEnCurso = true;
  try {
    novedadesUltimo = await revisarNovedades();
    renderNovedadesBadge();
    if (currentView === "gestion") setRefrescarCatalogoTextoNovedades();
  } catch {
    // silencioso: quedarse sin avisar es mejor que molestar con un error de red
  } finally {
    novedadesEnCurso = false;
  }
}

// El boton de Gestion deja de decir "Actualizar catalogo" (que no dice nada)
// y pasa a decir que va a traer.
function setRefrescarCatalogoTextoNovedades() {
  // Sin guard por refrescarCatalogoInProgress: al entrar a Gestion se dispara
  // sincronizarCatalogoSilencioso, que pone esa bandera en true, y con el
  // guard el boton se quedaba para siempre en "Actualizar catalogo". Cuando
  // hay una corrida en curso el texto lo maneja setRefrescarCatalogoEstado.
  if (!dom.refrescarCatalogo || dom.refrescarCatalogo.disabled) return;
  dom.refrescarCatalogo.textContent = novedadesUltimo.total > 0
    ? `⬇ Traer ${novedadesUltimo.texto}`
    : "Buscar cambios";
}

function setupNovedades() {
  dom.novedadesBadge?.addEventListener("click", () => traerNovedades());
  if (novedadesTimer) window.clearInterval(novedadesTimer);
  novedadesTimer = window.setInterval(revisarNovedadesAhora, 90000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revisarNovedadesAhora();
  });
  window.addEventListener("online", revisarNovedadesAhora);
}

async function traerNovedades() {
  if (refrescarCatalogoInProgress) return;
  const cursores = novedadesUltimo.cursoresNuevos;
  dom.novedadesBadge.disabled = true;
  refrescarCatalogoInProgress = true;
  try {
    await pullCatalogoCompleto();
    await marcarNovedadesTraidas(cursores);
    novedadesUltimo = { total: 0, texto: "", cursoresNuevos: null };
    renderNovedadesBadge();
    if (currentView === "gestion") await refreshGestionSubView(currentGestionSubView);
    if (currentView === "pedidos") await renderPedidosView();
    setFlash("Cambios traídos.", "success");
  } catch (error) {
    setFlash(error.message || "No se pudieron traer los cambios (revisá la conexión).", "error");
  } finally {
    refrescarCatalogoInProgress = false;
    dom.novedadesBadge.disabled = false;
    setRefrescarCatalogoTextoNovedades();
  }
}

// Estado de sincronizacion siempre visible. Antes era invisible: si un push a
// Supabase fallaba por un motivo que no fuera "sin conexion", la operacion
// quedaba encolada para siempre sin que nadie se enterara — asi se perdio
// produccion real que nunca llego a la nube. Ahora:
//  - banner "Sin conexion" mientras no hay internet,
//  - badge con lo pendiente (tocarlo fuerza un reintento inmediato),
//  - badge rojo si algo esta trabado (error repetido, sesion vencida, memoria llena),
//  - aviso "Todo sincronizado" cuando se vacia la cola tras haber tenido pendientes.
let syncPendienteAnterior = 0;
let syncPendienteDesde = 0;
let syncRedibujoTimeout = null;
// Una venta normal se sube en menos de un segundo: si el badge y el aviso
// aparecieran en cada venta serian ruido. Solo se muestran cuando algo lleva
// mas de esto pendiente (wifi lento, sin conexion, error).
const SYNC_VISIBLE_TRAS_MS = 2500;

function renderSyncStatus(status) {
  if (dom.offlineBanner) dom.offlineBanner.hidden = status.online;

  if (syncPendienteAnterior === 0 && status.pending > 0) syncPendienteDesde = Date.now();
  const lleva = Date.now() - syncPendienteDesde;
  const mostrar = status.pending > 0 && (lleva >= SYNC_VISIBLE_TRAS_MS || !status.online || status.lastError);
  if (status.pending > 0 && !mostrar) {
    window.clearTimeout(syncRedibujoTimeout);
    syncRedibujoTimeout = window.setTimeout(() => renderSyncStatus(getSyncStatus()), SYNC_VISIBLE_TRAS_MS - lleva + 50);
  }

  const badge = dom.syncStatusBadge;
  if (badge) {
    const trabado = status.storageError || status.authBlocked || status.blocked > 0;
    if ((status.pending === 0 || !mostrar) && !status.storageError) {
      badge.hidden = true;
    } else {
      badge.hidden = false;
      badge.classList.toggle("is-error", trabado);
      if (status.storageError) badge.textContent = "⚠ Memoria llena: no se puede guardar mas";
      else if (status.authBlocked) badge.textContent = `🔒 ${status.pending} sin sincronizar — volvé a iniciar sesión`;
      else if (status.blocked > 0) badge.textContent = `⚠ ${status.pending} sin sincronizar (${status.blocked} con error)`;
      else if (status.draining) badge.textContent = `⏳ Sincronizando ${status.pending}...`;
      else badge.textContent = `⏳ ${status.pending} sin sincronizar`;
    }
  }

  if (syncPendienteAnterior > 0 && status.pending === 0 && lleva >= SYNC_VISIBLE_TRAS_MS) {
    setFlash("Todo sincronizado ✓", "success");
    if (currentView === "historial" && !document.hidden) refreshView("historial").catch(() => {});
  }
  syncPendienteAnterior = status.pending;
}

function setupSyncBadge() {
  syncPendienteAnterior = getPendingSyncCount();
  renderSyncStatus(getSyncStatus());
  subscribeSyncStatus(renderSyncStatus);
  window.addEventListener("online", () => renderSyncStatus(getSyncStatus()));
  window.addEventListener("offline", () => renderSyncStatus(getSyncStatus()));
  dom.syncStatusBadge?.addEventListener("click", async () => {
    dom.syncStatusBadge.disabled = true;
    const resultado = await processSyncQueue({ force: true }).catch((e) => ({ synced: 0, pending: getPendingSyncCount(), lastError: { type: "?", message: e.message } }));
    const { synced, pending, offline, lastError } = resultado;
    dom.syncStatusBadge.disabled = false;
    renderSyncStatus(getSyncStatus());
    if (pending === 0) return; // "Todo sincronizado" lo avisa renderSyncStatus
    if (synced > 0) setFlash(`${synced} sincronizados, ${pending} pendientes todavia.`, "warning");
    else if (offline) setFlash("Sin conexion — se reintenta solo cuando vuelva el wifi.", "warning");
    else if (lastError) setFlash(`No se pudo sincronizar (${lastError.type}): ${lastError.message}`, "error");
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

const CONSULTA_VIEWS = ["caja", "produccion", "historial", "panel"];

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
  dom.crearInsumoEnvase.value = "";
  dom.crearInsumoEnvaseTrae.value = "";
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

// Insumos incluye la calibracion (es el mismo ciclo: que tengo / cuanto gasto
// de verdad). El resto son pantallas propias.
const SUBVISTAS_FUSIONADAS = { calibrar: "insumos" };

async function refreshGestionSubView(subViewName) {
  if (subViewName === "insumos") {
    await renderInsumosView();
    if (dom.seccionCalibracion?.open) await renderCalibracionView();
  }
  if (subViewName === "menu") await renderMenuView();
  if (subViewName === "recetas") await renderRecetasView();
  if (subViewName === "variantes") await renderVariantesView();
  if (subViewName === "proveedores") await renderProveedoresView();
}

function showGestionSubView(subViewName) {
  // Una pestaña vieja (o un dispositivo que venia con "calibrar"/"recetas"
  // guardado de antes de la fusion) cae en la pantalla que ahora las contiene.
  subViewName = SUBVISTAS_FUSIONADAS[subViewName] || subViewName;
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
    setRefrescarCatalogoTextoNovedades();
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

// La tarjeta no tiene vuelto que calcular — el "Pago con" es una ayuda-memoria
// de efectivo (ver recalcularVuelto), asi que se oculta con tarjeta y se
// limpia si habia algo tipeado.
function setFormaPago(forma) {
  formaPagoActual = forma;
  dom.pagoFormaEfectivo.classList.toggle("active", forma === "efectivo");
  dom.pagoFormaEfectivo.setAttribute("aria-pressed", String(forma === "efectivo"));
  dom.pagoFormaTarjeta.classList.toggle("active", forma === "tarjeta");
  dom.pagoFormaTarjeta.setAttribute("aria-pressed", String(forma === "tarjeta"));
  dom.cartVuelto.hidden = forma === "tarjeta";
  if (forma === "tarjeta") resetVuelto();
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
      // Misma fuente que el Historial y el resumen (datosRemotosDelDia en
      // business.js): producido = produccion + correcciones de error de
      // produccion, vendido y "ayer quedaron" salen del ledger. Antes esta
      // pantalla tenia su propia copia del calculo y se desalineaba (ayer =
      // stock - producido + vendido ignoraba cualquier ajuste del dia).
      const { snapshot, historico } = await datosRemotosDelDia(todayISO());
      const productosProduccion = snapshot.productionProducts
        .filter((p) => p.categoriaId === "sandwiches" || p.categoriaId === "bolleria")
        .map((p) => ({ ...p, cantidadAyer: historico.get(p.id)?.stockAlInicio ?? 0 }));
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
    onPrintSale: handlePrintSale,
    pendingUuids: getPendingVentaUuids()
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

// Llena un selector con las unidades en las que se puede escribir ese insumo
// (g/kg, ml/L...) y deja elegida la que corresponde al valor que se muestra.
// Si el insumo no tiene multiplos (unidad, rebanada) el selector queda con una
// sola opcion y no molesta.
// El envase de un insumo, como lo entiende utils/unidades.js: el nombre con el
// que se cuenta a ojo (botella, bolsa, paquete, pote) y cuantas unidades base
// trae cada uno. Asi la leche se escribe y se lee en ml, en L o en botellas.
function envaseDeInsumo(insumo) {
  if (!insumo) return null;
  return { nombre: insumo.unidadCompra, equivale: insumo.factorConversion };
}

function llenarSelectorUnidad(select, unidadBase, unidadElegida, envase = null) {
  const opciones = unidadesDisponibles(unidadBase, envase);
  select.innerHTML = opciones.map((u) => `<option value="${u}">${etiquetaUnidad(u)}</option>`).join("");
  // Si la unidad pedida no esta entre las opciones (cambio el envase), se cae a
  // la primera en vez de dejar el selector en blanco.
  select.value = opciones.includes(unidadElegida) ? unidadElegida : opciones[0];
  select.disabled = opciones.length <= 1;
  select.dataset.unidadPrevia = select.value;
}

// Lo que hay escrito en el campo, convertido a la unidad base del insumo.
function cantidadEnBase(input, select, unidadBase, envase = null) {
  return aBase(parseFloat(String(input.value).replace(",", ".")), select?.value || unidadBase, unidadBase, envase);
}

function updateAjusteDeltaHint(insumo) {
  const hint = dom.insumosAjusteDeltaHint;
  if (!insumo) { hint.textContent = ""; hint.className = "insumo-stepper-hint"; return; }
  // Se compara en la unidad BASE, aunque se haya escrito en kg o en L.
  const nuevoBase = cantidadEnBase(dom.insumosAjusteCantidad, dom.insumosAjusteUnidad, insumo.unidad, envaseDeInsumo(insumo));
  if (!Number.isFinite(nuevoBase)) { hint.textContent = ""; hint.className = "insumo-stepper-hint"; return; }
  const delta = parseFloat((nuevoBase - insumo.stockActual).toFixed(4));
  if (delta === 0) {
    hint.textContent = "Sin cambios respecto al stock actual";
    hint.className = "insumo-stepper-hint";
  } else {
    hint.textContent = `${delta > 0 ? "+" : "−"}${formatearCantidad(Math.abs(delta), insumo.unidad)} respecto al stock actual`;
    hint.className = `insumo-stepper-hint ${delta > 0 ? "sube" : "baja"}`;
  }
}

// "= 4 kg" debajo del campo de compra: confirma cuanto entra al stock.
function updateCompraEquivale(insumo) {
  if (!dom.insumosCompraEquivale) return;
  const n = parseFloat(String(dom.insumosCompraCantidad.value).replace(",", "."));
  if (!insumo || !Number.isFinite(n) || n <= 0) { dom.insumosCompraEquivale.textContent = ""; return; }
  dom.insumosCompraEquivale.textContent = `Entran ${formatearCantidad(n * (insumo.factorConversion || 1), insumo.unidad)} al stock`;
}

// deficitBase (opcional): cuanto faltaba en la unidad BASE del insumo (ej.
// gramos), cuando se llega aca desde el aviso de "Falta stock de insumos"
// en Produccion. Se convierte a la unidad de COMPRA tal cual (sin
// redondear para arriba — el valor exacto que aviso "Falta stock", para que
// coincida con lo que el usuario ya vio ahi) y se deja precargado pero
// editable, por si lo que se compro en la realidad fue otra cantidad.
function openInsumoAjusteSheet(insumo, deficitBase) {
  selectedInsumoId = insumo.id;
  selectedInsumo = insumo;
  renderInsumoAjusteSelected(dom.insumosAjusteSelected, insumo);
  setInsumosAjusteTipo("compra");
  dom.insumosCompraLabel.textContent = `Cantidad recibida (${insumo.unidadCompra} = ${insumo.factorConversion} ${insumo.unidad})`;
  dom.insumosCompraCantidad.value = deficitBase > 0
    ? String(parseFloat((deficitBase / (insumo.factorConversion || 1)).toFixed(3)))
    : "";
  // El stock se muestra en la unidad mas clara (5000 g -> 5 kg) y el selector
  // queda en esa misma, asi lo que se escribe arriba coincide con lo que se lee.
  const unidadVista = mejorUnidad(insumo.stockActual, insumo.unidad);
  llenarSelectorUnidad(dom.insumosAjusteUnidad, insumo.unidad, unidadVista, envaseDeInsumo(insumo));
  dom.insumosAjusteCantidad.value = paraInput(desdeBase(insumo.stockActual, dom.insumosAjusteUnidad.value, insumo.unidad, envaseDeInsumo(insumo)));
  dom.insumosAjusteMotivos.querySelectorAll("input[type='radio']").forEach(r => { r.checked = false; });
  updateAjusteDeltaHint(insumo);
  updateCompraEquivale(insumo);
  setInsumosAjusteSheetOpen(true);
  dom.insumosCompraCantidad.focus();
}

// Abre el siguiente insumo de colaFaltantesInsumos (ver dom.insumoWarningUpdate
// y el submit de insumosAjusteForm) — false si la cola ya esta vacia, para
// que el que llama sepa si tiene que cerrar todo o dejar la hoja abierta
// con el proximo insumo.
async function abrirSiguienteFaltanteInsumo() {
  if (colaFaltantesInsumos.length === 0) return false;
  const restantes = colaFaltantesInsumos.length;
  const faltante = colaFaltantesInsumos.shift();
  const insumos = await listInsumos();
  const insumo = insumos.find((i) => i.id === faltante.insumoId);
  if (!insumo) return abrirSiguienteFaltanteInsumo();
  openInsumoAjusteSheet(insumo, Math.abs(faltante.stockResultante));
  if (restantes > 1) setFlash(`Cargá ${insumo.nombre} — quedan ${restantes - 1} más después de este.`, "warning");
  return true;
}

function closeInsumoAjusteSheet() {
  // Si se cierra a mitad de la cadena de faltantes (el usuario cancela en
  // vez de guardar), se descarta el resto de la cola Y la produccion
  // pendiente — sin esto, (a) abrir CUALQUIER otro insumo despues seguiria
  // saltando a los que quedaron pendientes de esta corrida vieja, y (b) una
  // compra de insumo futura sin ninguna relacion terminaria reintentando
  // esta MISMA produccion vieja por error (ver el auto-reintento en el
  // submit de insumosAjusteForm).
  colaFaltantesInsumos = [];
  pendingProduction = null;
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
  const stockDisplay = formatearConEnvase(insumo.stockActual, insumo.unidad, envaseDeInsumo(insumo));
  dom.calibracionSelected.innerHTML = `
    <strong>${insumo.nombre}</strong>
    <small>Sistema calcula: ${stockDisplay}</small>
  `;
  dom.calibracionLabel.textContent = "Stock real que contás";
  // Se ofrece la unidad en la que es comodo contar: si el sistema calcula
  // 3450 g, lo natural es pesar en kg.
  llenarSelectorUnidad(dom.calibracionUnidad, insumo.unidad, mejorUnidad(insumo.stockActual, insumo.unidad), envaseDeInsumo(insumo));
  dom.calibracionCantidad.value = "";
  dom.calibracionEquivale.textContent = "";
  selectedInsumo = insumo;
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

// listInsumos() ya devuelve ordenado por estado (critico/bajo/ok) — los
// otros dos modos se aplican encima ac, sin tocar esa funcion (sigue
// sirviendo tal cual para todo lo demas que la usa, ej. la cola de
// faltantes de produccion).
function ordenarInsumosParaVista(insumos, modo) {
  if (modo === "reciente") {
    return insumos.slice().sort((a, b) => String(b.actualizadoEn || "").localeCompare(String(a.actualizadoEn || "")));
  }
  if (modo === "cantidad") {
    return insumos.slice().sort((a, b) => (Number(b.stockActual) || 0) - (Number(a.stockActual) || 0));
  }
  return insumos;
}

// Aviso de ciclo incompleto: insumos que entran pero nunca salen (sin receta)
// o que no tienen a quien comprarse (sin proveedor). No bloquea nada; solo
// hace visible la deuda, que si no queda invisible para siempre.
// Si el aviso de pendientes quedo abierto o cerrado, por dispositivo. Es una
// preferencia de quien mira la pantalla, no un dato del negocio: va en
// localStorage y no se sincroniza.
const MOSTRAR_CICLO_KEY = "miga_ciclo_abierto";
function cicloAbierto() {
  try { return localStorage.getItem(MOSTRAR_CICLO_KEY) === "1"; } catch { return false; }
}
function recordarCicloAbierto(abierto) {
  try { localStorage.setItem(MOSTRAR_CICLO_KEY, abierto ? "1" : "0"); } catch { /* sin localStorage: se abre cerrado y listo */ }
}

async function renderAvisoCiclo() {
  if (!dom.avisoCiclo) return;
  const [insumos, recetas, proveedorInsumos, proveedores, productos] = await Promise.all([
    getAll("insumos"), getAll("recetas"), getAll("proveedor_insumos"), getAll("proveedores"), listProducts()
  ]);
  const pendientes = pendientesDelCiclo(revisarCicloInsumos({
    insumos, recetas, proveedorInsumos, gruposVariantes: gruposVariantesActual
  }));
  renderPendientesCiclo(dom.avisoCiclo, {
    pendientes,
    abierto: cicloAbierto(),
    resumen: resumenPendientes(pendientes),
    proveedores: proveedores.filter((p) => p.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    productos: productos.filter((p) => p.controlaStock || p.categoriaId === "cafe" || p.categoriaId === "bebidas")
  });
  // "toggle" no burbujea: hay que engancharlo al <details> recien pintado, no
  // delegarlo en el contenedor como el resto de los eventos de la app.
  const plegable = dom.avisoCiclo.querySelector(".aviso-ciclo-plegable");
  if (plegable) plegable.addEventListener("toggle", () => recordarCicloAbierto(plegable.open));
}

// "No lo uso": saca el insumo de circulacion en vez de obligar a inventarle
// una receta. El dueño lo pidio asi: "esto si no tiene solucion, prefiero tener
// la posibilidad de eliminarlo".
async function descartarPendienteCiclo(article) {
  const error = article.querySelector(".pendiente-error");
  const insumoId = article.dataset.insumo;
  const nombre = article.querySelector("strong")?.textContent || insumoId;
  const confirmado = await confirmDialog({
    title: `¿Ya no usás ${nombre}?`,
    message: `Sale de tus insumos y deja de aparecer en la lista de compras.\n\nNo se borra nada: su historial queda guardado y podés volver a activarlo cuando quieras.`,
    acceptText: "Sí, no lo uso",
    cancelText: "Dejarlo"
  });
  if (!confirmado) return;

  const boton = article.querySelector('[data-accion="descartar"]');
  boton.disabled = true;
  try {
    const { lineasProveedor } = await descartarInsumo(insumoId);
    setFlash(`"${nombre}" salió de la lista${lineasProveedor > 0 ? ` (y ${lineasProveedor} línea${lineasProveedor === 1 ? "" : "s"} de proveedor)` : ""}.`, "success");
    await renderInsumosView();
  } catch (e) {
    error.textContent = e.message || "No se pudo sacar de la lista.";
    error.hidden = false;
    boton.disabled = false;
  }
}

// Guarda un pendiente completado en el propio aviso.
async function guardarPendienteCiclo(article) {
  const error = article.querySelector(".pendiente-error");
  const { datos, error: motivo } = leerPendiente(article);
  if (motivo) { error.textContent = motivo; error.hidden = false; return; }
  error.hidden = true;
  const boton = article.querySelector('[data-accion="guardar"]');
  boton.disabled = true;
  try {
    if (article.dataset.falta === "proveedor") {
      await saveProveedorInsumo(datos);
      setFlash(`Listo: ya se puede pedir a un proveedor.`, "success");
    } else {
      await crearLineaReceta({ productoId: datos.productoId, insumoId: datos.insumoId, cantidadPorUnidad: datos.cantidad });
      setFlash("Listo: ahora se descuenta al producir o vender.", "success");
    }
    await renderInsumosView();
  } catch (e) {
    error.textContent = e.message || "No se pudo guardar.";
    error.hidden = false;
    boton.disabled = false;
  }
}

async function renderInsumosView() {
  const insumos = await listInsumos();
  const ordenados = ordenarInsumosParaVista(insumos, dom.insumosOrden?.value || "estado");
  renderInsumosList(dom.insumosList, ordenados, openInsumoAjusteSheet);
  renderCalibracionAlert(dom.calibracionAlert, insumos);
  await renderAvisoCiclo();
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
  dom.recetaEditContext.textContent = `Cantidad actual: ${formatearCantidad(receta.cantidadPorUnidad, receta.unidad)} por unidad${receta.esEstimado ? " (estimado)" : ""}`;
  dom.recetaEditLabel.textContent = "Nueva cantidad por unidad";
  // En recetas las cantidades son chicas (25 g, 210 ml), asi que arranca en la
  // unidad base — pero el selector esta por si hace falta cargar en kg o L.
  recetaEditEnvase = { nombre: receta.unidadCompra, equivale: receta.factorConversion };
  llenarSelectorUnidad(dom.recetaEditUnidad, receta.unidad, receta.unidad, recetaEditEnvase);
  dom.recetaEditCantidad.value = paraInput(receta.cantidadPorUnidad);
  recetaEditUnidadBase = receta.unidad;
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
  dom.provEditLead.value = String(proveedor.leadTimeDias ?? 0);
  marcarDiasEntrega(proveedor.diasEntrega);
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
  dom.provEditLead.value = "0";
  marcarDiasEntrega(null);
  setProvEditSheetOpen(true);
  dom.provEditNombre.focus();
}

// Los siete botones de dias de entrega, prendidos segun lo guardado.
// La convencion es la de Date.getDay(): 0=domingo .. 6=sabado, igual que en la
// base y en compras-calculos.js, para no traducir numeros en el camino.
function marcarDiasEntrega(dias) {
  const activos = new Set(Array.isArray(dias) ? dias.map(Number) : []);
  dom.provEditEntrega.querySelectorAll(".dia-btn").forEach((btn) => {
    btn.classList.toggle("active", activos.has(Number(btn.dataset.dia)));
  });
}

// Lo que quedo marcado, ordenado. Ninguno marcado devuelve null, que significa
// "entrega cualquier dia" — distinto de un array vacio, que seria "no entrega
// ningun dia" y dejaria la lista de compras sin fecha de llegada posible.
function leerDiasEntrega() {
  const dias = [...dom.provEditEntrega.querySelectorAll(".dia-btn.active")]
    .map((btn) => Number(btn.dataset.dia))
    .sort((a, b) => a - b);
  return dias.length > 0 ? dias : null;
}

function closeProvEdit() {
  setProvEditSheetOpen(false);
  selectedProvId = "";
  provEditMode = "edit";
}

function renderProvProdRecetaRowsView() {
  renderProvProdRecetaRows(dom.provProdRecetaRows, provProdRecetaVinculos, provProdProductosDisponibles, { yaEnReceta: provProdRecetaYaEnReceta });
}

// Repinta la seleccion sobre el HTML que ya esta puesto. Reconstruirlo en cada
// tap perdia el scroll de la lista y cerraba los grupos abiertos.
function pintarProvProdRecetaSeleccion() {
  aplicarProvProdRecetaSeleccion(dom.provProdRecetaRows, provProdRecetaVinculos, provProdProductosDisponibles, { yaEnReceta: provProdRecetaYaEnReceta });
}

// Marca o desmarca un producto. El array es la unica fuente de verdad: el DOM
// se deriva de el (ver aplicarProvProdRecetaSeleccion).
function setProvProdRecetaProducto(productoId, incluir) {
  if (!productoId || provProdRecetaYaEnReceta.has(productoId)) return;
  const idx = provProdRecetaVinculos.findIndex((v) => v.productoId === productoId);
  if (incluir && idx === -1) provProdRecetaVinculos.push({ productoId, cantidad: "" });
  if (!incluir && idx !== -1) provProdRecetaVinculos.splice(idx, 1);
}

// Desmarcar una receta que YA existe no es lo mismo que no marcar una nueva:
// borra la linea. Por eso pregunta, y por eso se aplica al instante en vez de
// esperar al Guardar — asi el estado de la pantalla no miente sobre lo que
// ya pasó.
async function quitarRecetaExistente(productoId, checkbox) {
  const insumoId = dom.provProdInsumo.value;
  const producto = provProdProductosDisponibles.find((p) => p.id === productoId);
  const nombre = producto?.nombre || productoId;
  const confirmado = await confirmDialog({
    title: `¿Sacarlo de ${nombre}?`,
    message: `Ese producto deja de descontar este insumo al producirse o venderse.\n\nSe borra la línea de receta. El consumo que ya quedó registrado no se toca.`,
    acceptText: "Sacarlo",
    cancelText: "Dejarlo"
  });
  if (!confirmado) { checkbox.checked = true; return; }

  try {
    await eliminarLineaReceta(`${productoId}:${insumoId}`);
    provProdRecetaYaEnReceta.delete(productoId);
    setFlash(`Ya no se descuenta en ${nombre}.`, "success");
    aplicarProvProdRecetaSeleccion(dom.provProdRecetaRows, provProdRecetaVinculos, provProdProductosDisponibles, { yaEnReceta: provProdRecetaYaEnReceta });
  } catch (error) {
    checkbox.checked = true;
    setFlash(error.message || "No se pudo sacar de la receta.", "error");
  }
}

function limpiarProvProdNuevoInsumoFields() {
  dom.provProdNuevoNombre.value = "";
  dom.provProdNuevoUnidad.value = "";
  dom.provProdNuevoMin.value = "";
  dom.provProdNuevoCrit.value = "";
  provProdRecetaVinculos = [];
  provProdRecetaYaEnReceta = new Map();
  insumoRecetaCargado = null;
  dom.provProdRecetaCantidad.value = "";
}

async function openProvProdAdd(proveedorId) {
  selectedProvId = proveedorId;
  selectedProvProdId = "";
  provProdMode = "add";
  dom.provProdTitle.textContent = "Agregar lo que te vende este proveedor";
  dom.provProdContext.textContent = "";
  dom.provProdNombre.value = "";
  dom.provProdUnidad.value = "";
  dom.provProdCantidad.value = "";
  dom.provProdPrecio.value = "";
  limpiarProvProdNuevoInsumoFields();
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, "");
  provProdProductosDisponibles = await listProducts();
  await refrescarProvProdReceta();
  setProvProdSheetOpen(true);
  dom.provProdNombre.focus();
}

async function openProvProdEdit(producto) {
  selectedProvId = producto.proveedorId;
  selectedProvProdId = producto.id;
  provProdMode = "edit";
  dom.provProdTitle.textContent = "Editar lo que te vende este proveedor";
  dom.provProdContext.textContent = producto.nombreProducto;
  dom.provProdNombre.value = producto.nombreProducto;
  dom.provProdUnidad.value = producto.unidadCompra ?? "";
  dom.provProdCantidad.value = String(producto.cantidadPorUnidad ?? "");
  dom.provProdPrecio.value = String((producto.precioUnitarioCentavos / 100).toFixed(2));
  limpiarProvProdNuevoInsumoFields();
  const insumos = await listInsumos();
  renderProvProdInsumoSelect(dom.provProdInsumo, insumos, producto.insumoId ?? "");
  provProdProductosDisponibles = await listProducts();
  await refrescarProvProdReceta();
  setProvProdSheetOpen(true);
  dom.provProdNombre.focus();
}

function closeProvProd() {
  setProvProdSheetOpen(false);
  selectedProvId = "";
  selectedProvProdId = "";
}

// La unidad de CONSUMO del insumo (la de la receta y la del stock), venga del
// insumo que se esta creando o del que ya existe y se eligio en el selector.
// Antes se sacaba con un regex sobre el texto de la opcion; ahora la opcion
// trae data-unidad (ver renderProvProdInsumoSelect).
function unidadBaseProvProd() {
  const insumoId = dom.provProdInsumo.value;
  if (insumoId === "__nuevo__") return dom.provProdNuevoUnidad.value.trim();
  if (!insumoId) return "";
  const option = dom.provProdInsumo.options[dom.provProdInsumo.selectedIndex];
  return (option?.dataset.unidad || "").trim();
}

// "Cantidad por unidad de compra (unidades)" no se entendia, y la lectura
// natural era la equivocada: el dueño asumio que eran los ENVASES que trae la
// caja. Son las unidades BASE: la leche de Makro viene por caja y el valor es
// 9000 (6 botellas x 1,5 L = 9000 ml), no 6. Poner 6 hace creer a la app que
// una caja son 6 ml y la lista de compras pide cientos de cajas — es el mismo
// modo de falla que hizo pedir 3862 litros de leche de soja.
//
// Asi que el label se arma en vivo con las dos cosas que la persona ya escribio
// en esta misma sheet: "¿Cuántos ml trae cada caja?".
function updateProvProdCantidadLabel() {
  const insumoId = dom.provProdInsumo.value;
  const esNuevo = insumoId === "__nuevo__";
  dom.provProdNuevoInsumoFields.hidden = !esNuevo;

  const base = unidadBaseProvProd();
  const compra = dom.provProdUnidad.value.trim();
  const baseEtq = base ? etiquetaUnidad(base) : "";
  const compraEtq = compra ? etiquetaUnidad(compra) : "";

  if (baseEtq && compraEtq) {
    dom.provProdCantidadLabel.textContent = `¿Cuántos ${baseEtq} trae cada ${compraEtq}?`;
  } else if (baseEtq) {
    dom.provProdCantidadLabel.textContent = `¿Cuántos ${baseEtq} trae cada unidad que te factura?`;
  } else if (compraEtq) {
    dom.provProdCantidadLabel.textContent = `¿Cuánto trae cada ${compraEtq}, en la unidad del insumo?`;
  } else {
    dom.provProdCantidadLabel.textContent = "¿Cuánto trae cada unidad de compra?";
  }

  const ejemplo = "Una caja de 6 botellas de 1,5 L son 9000 ml, no 6.";
  dom.provProdCantidadAyuda.textContent = baseEtq && compraEtq
    ? `Lo que hay en total dentro de cada ${compraEtq}, medido en ${baseEtq} — no cuántos envases trae. ${ejemplo}`
    : `El total en la unidad en la que usás el insumo (g, ml, unidad...), no cuántos envases trae. ${ejemplo}`;
}

// El campo de cantidad de la receta decia solo "Cantidad": con "L" escrito
// arriba no habia forma de saber si esos 25 eran gramos, mililitros o litros.
// Misma redaccion que el formulario de pendientes de ciclo.
function updateProvProdRecetaCantidadLabel() {
  const base = unidadBaseProvProd();
  dom.provProdRecetaCantidadUnidad.textContent = base
    ? `(en ${etiquetaUnidad(base)})`
    : "(en la unidad base de arriba)";
}

// Muestra u oculta el bloque de recetas y lo deja al dia. Si el insumo elegido
// ya existe, precarga las lineas de receta que ya tiene para que se vean (y no
// se dupliquen ni se pisen sus cantidades).
async function refrescarProvProdReceta() {
  updateProvProdCantidadLabel();
  const insumoId = dom.provProdInsumo.value;
  // Sin insumo vinculado (reventa) no hay receta posible.
  dom.provProdRecetaSection.hidden = !insumoId;
  if (!insumoId) {
    provProdRecetaVinculos = [];
    provProdRecetaYaEnReceta = new Map();
    updateProvProdRecetaCantidadLabel();
    return;
  }

  provProdRecetaYaEnReceta = new Map();
  if (insumoId !== insumoRecetaCargado) {
    // Cambiar de insumo empieza de cero: lo marcado era para el anterior.
    provProdRecetaVinculos = [];
    insumoRecetaCargado = insumoId;
  }
  if (insumoId !== "__nuevo__") {
    const porProducto = await getRecetasDashboardData();
    for (const entrada of porProducto) {
      const linea = entrada.recetas.find((r) => r.insumoId === insumoId);
      if (linea) provProdRecetaYaEnReceta.set(entrada.productoId, formatearCantidad(linea.cantidadPorUnidad, linea.unidad));
    }
  }
  // Un producto que ya la lleva no puede estar tambien en "para agregar".
  provProdRecetaVinculos = provProdRecetaVinculos.filter((v) => !provProdRecetaYaEnReceta.has(v.productoId));

  dom.provProdRecetaAyuda.textContent = provProdRecetaYaEnReceta.size > 0
    ? "Tocá una categoría para marcar todos sus productos de una. Lo que ya está en su receta aparece con su cantidad y no se toca desde acá: para sacarlo o cambiarlo, andá a Gestión › Recetas."
    : "Tocá una categoría para marcar todos sus productos de una, y desmarcá los que no lo lleven. Podés sumar productos de varias categorías.";

  renderProvProdRecetaRowsView();
  updateProvProdRecetaCantidadLabel();
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
  renderMenuRecetaRows(dom.menuRecetaRows, menuRecetaLineas, menuInsumosDisponibles, menuGruposVarianteDisponibles, menuProveedoresDisponibles);
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
  menuProductoEditando = null;
  // Un producto que todavia no existe no se puede eliminar.
  dom.menuEditEliminarWrap.hidden = true;
  dom.menuEditTitle.textContent = "Agregar producto";
  dom.menuEditNombre.value = "";
  dom.menuEditPrecio.value = "";
  dom.menuEditControlaStock.checked = true;
  dom.menuEditUmbral.value = "10";
  dom.menuEditSandwichTipo.value = "basico";
  dom.menuEditActivo.checked = true;
  menuRecetaLineas = [];
  menuInsumosDisponibles = await listInsumos();
  menuProveedoresDisponibles = (await getAll("proveedores"))
    .filter((p) => p.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  menuProductoEditando = producto;
  dom.menuEditEliminarWrap.hidden = false;
  dom.menuEditTitle.textContent = "Editar producto";
  dom.menuEditNombre.value = producto.nombre;
  dom.menuEditPrecio.value = (producto.precioCentavos / 100).toFixed(2);
  dom.menuEditControlaStock.checked = !!producto.controlaStock;
  dom.menuEditUmbral.value = String(producto.umbralBajo ?? 0);
  dom.menuEditSandwichTipo.value = producto.sandwichTipo === "premium" ? "premium" : "basico";
  dom.menuEditActivo.checked = !!producto.activo;
  menuInsumosDisponibles = await listInsumos();
  menuProveedoresDisponibles = (await getAll("proveedores"))
    .filter((p) => p.activo !== false)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  menuProductoEditando = null;
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

// Borrado definitivo, lo que pidio el dueño: no hay papelera ni "deshacer".
// Primero se consulta si se PUEDE (menu.js pregunta a la nube por ventas,
// movimientos y pedidos abiertos) y recien despues se pide confirmacion — al
// reves, el usuario confirmaria un borrado irreversible para despues recibir
// un "no se pudo", que es la peor secuencia posible.
async function handleEliminarProducto() {
  if (menuEliminarInProgress) return;
  if (menuProductoMode !== "edit" || !selectedMenuProductoId) return;
  const id = selectedMenuProductoId;
  menuEliminarInProgress = true;
  dom.menuEditEliminar.disabled = true;
  let sheetBajado = false;
  try {
    setFlash("Revisando si este producto se puede eliminar...", "warning");
    const chequeo = await verificarEliminacionProducto(id);

    if (!chequeo.puede) {
      setFlash(mensajeBloqueoEliminacion(chequeo), "error");
      return;
    }

    // El sheet del producto y el dialogo de confirmacion comparten la clase
    // .stock-adjust-sheet y no hay z-index entre ellos: el sheet esta DESPUES
    // en el HTML, asi que se pinta encima y se come los taps del dialogo
    // (verificado en el navegador: el boton "No, dejarlo" era imposible de
    // tocar). Se baja el sheet mientras se pregunta y se vuelve a subir si la
    // respuesta es no — los campos del formulario quedan como estaban porque
    // setMenuEditSheetOpen solo mueve la visibilidad, no limpia el estado.
    setMenuEditSheetOpen(false);
    sheetBajado = true;
    const confirmado = await confirmDialog({
      title: "Eliminar definitivamente",
      message: mensajeConfirmacionEliminacion(chequeo),
      acceptText: "Eliminar para siempre",
      cancelText: "No, dejarlo"
    });
    if (!confirmado) {
      setMenuEditSheetOpen(true);
      setFlash("No se elimino nada.", "warning");
      return;
    }

    const resultado = await eliminarProducto(id);
    closeMenuEdit();
    await renderMenuView();
    setFlash(`"${resultado.nombre}" eliminado definitivamente.`, "success");
  } catch (error) {
    // Si fallo DESPUES de bajar el sheet para preguntar, hay que volver a
    // subirlo: el producto no se borro, y dejar la pantalla vacia con solo un
    // mensaje de error haria parecer que algo paso cuando no paso nada.
    if (sheetBajado && selectedMenuProductoId === id) setMenuEditSheetOpen(true);
    setFlash(error.message || "No se pudo eliminar el producto.", "error");
  } finally {
    menuEliminarInProgress = false;
    dom.menuEditEliminar.disabled = false;
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

async function handleReordenarProductos(categoriaId, idsEnOrden) {
  try {
    await reordenarProductos(categoriaId, idsEnOrden);
    await renderMenuView();
    setFlash("Orden actualizado.", "success");
  } catch (error) {
    setFlash(error.message || "No se pudo guardar el orden.", "error");
    await renderMenuView();
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
  renderCombosConfigForm();
  // renderMenuList rehace el HTML en cada render, asi que el arrastre se
  // vuelve a enganchar sobre los nodos nuevos.
  habilitarArrastre(dom.menuList, {
    selectorAsa: ".asa-orden",
    selectorFila: "tr[data-fila-id]",
    onReordenar: handleReordenarProductos
  });
}

function renderCombosConfigForm() {
  const c = getCombosConfigActual();
  dom.menuComboDocena.value = (c.docePrecioCentavos / 100).toFixed(2);
  dom.menuComboMedia.value = (c.seisPrecioCentavos / 100).toFixed(2);
  dom.menuComboPremium.value = (c.premiumExtraCentavos / 100).toFixed(2);
  dom.menuCombosStatus.hidden = true;
}

let menuCombosGuardarInProgress = false;

async function handleGuardarCombosConfig() {
  if (menuCombosGuardarInProgress) return;
  const docePrecioCentavos = Math.round(parseDecimal(dom.menuComboDocena.value) * 100);
  const seisPrecioCentavos = Math.round(parseDecimal(dom.menuComboMedia.value) * 100);
  const premiumExtraCentavos = Math.round(parseDecimal(dom.menuComboPremium.value) * 100);
  if ([docePrecioCentavos, seisPrecioCentavos, premiumExtraCentavos].some((n) => !Number.isFinite(n) || n < 0)) {
    setFlash("Revisá los importes de las promos — tienen que ser numeros, 0 o mas.", "error");
    return;
  }
  menuCombosGuardarInProgress = true;
  dom.menuCombosGuardar.disabled = true;
  try {
    await guardarCombosConfig({ docePrecioCentavos, seisPrecioCentavos, premiumExtraCentavos });
    setFlash("Promos actualizadas.", "success");
  } catch (error) {
    setFlash(error.message || "No se pudieron guardar las promos.", "error");
  } finally {
    menuCombosGuardarInProgress = false;
    dom.menuCombosGuardar.disabled = false;
  }
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
  if (viewName === "panel") await renderPanelView();
  if (viewName === "cierre") await renderCierreView();
  if (viewName === "gestion") await refreshGestionSubView(currentGestionSubView);
}

// Panel: ventas, horarios pico y stock. Lee de la nube (verdad de todos los
// dispositivos) y, sin conexion, cae a lo guardado en este dispositivo.
let panelFecha = null;
let panelCargando = false;

async function renderPanelView() {
  if (!panelFecha) panelFecha = todayISO();
  dom.panelDate.value = panelFecha;
  if (panelCargando) return;
  panelCargando = true;
  try {
    const datos = await cargarPanel(panelFecha);
    if (currentView === "panel") renderPanel(dom.panelRoot, datos);
  } catch (error) {
    dom.panelRoot.textContent = `No se pudo cargar el panel: ${error.message || error}`;
  } finally {
    panelCargando = false;
  }
}

function setPanelFecha(fecha) {
  if (!fecha) return;
  panelFecha = fecha;
  renderPanelView();
}

// Cierre de caja: la tarjeta sale del cierre de Postnet (se anota a mano), el
// efectivo esperado se deduce por resta, y cada cierre se guarda como registro
// nuevo que no se edita (ver migracion 015).
let cierreFecha = null;
let cierreDatos = null;
let cierreCargando = false;
let cierreGuardando = false;

const fechaDelCierre = () => cierreFecha || dom.cierreDate.value || todayISO();

let cajaMovEnCurso = false;
let cajaFotoActual = null;

function setSheetOpen(sheet, backdrop, abierto) {
  sheet.classList.toggle("open", abierto);
  sheet.setAttribute("aria-hidden", abierto ? "false" : "true");
  backdrop.hidden = !abierto;
  backdrop.classList.toggle("open", abierto);
}

function formaPagoElegida() {
  return dom.cajaPagoForma.querySelector(".tipo-btn.active")?.dataset.forma || "efectivo";
}

// Los tres pasos se dibujan juntos: cada uno depende de lo que pasó en el
// anterior (el fondo de la apertura entra en la cuenta del retiro).
// Anular es la misma accion en los dos pasos (pagos y retiros), asi que el
// manejador es uno solo. No borra: appendea el importe al reves, enlazado al
// original. Los dos quedan a la vista y el total da bien solo.
async function manejarAnular(event) {
  const btn = event.target.closest("[data-anular]");
  if (!btn || cajaMovEnCurso) return;
  const confirmado = await confirmDialog({
    title: "\u00bfAnular este movimiento?",
    message: "Deja de contar en los totales del d\u00eda.\n\nQueda anotado que se anul\u00f3, tachado en la lista: no se borra, para que el d\u00eda siga siendo auditable.",
    acceptText: "Anular",
    cancelText: "Dejarlo"
  });
  if (!confirmado) return;
  try {
    cajaMovEnCurso = true;
    await anularMovimiento(btn.dataset.anular, { motivo: "anulado desde el cierre" });
    setFlash("Movimiento anulado.", "success");
    await refrescarPasosCaja();
    await renderCierreView();
  } catch (error) {
    setFlash(error.message || "No se pudo anular.", "error");
  } finally { cajaMovEnCurso = false; }
}

// El mini cierre del retiro: cuanto deberia haber, cuanto se saca, cuanto
// queda. Se repinta mientras se tipea, que es cuando sirve para decidir.
function pintarCuentaRetiro() {
  if (!cajaFotoActual) { dom.cajaRetiroCuenta.innerHTML = ""; dom.cajaRetiroQueda.textContent = ""; return; }
  const f = cajaFotoActual;
  const fila = (texto, valor) => `<div class="cierre-row"><span>${texto}</span><strong>${valor}</strong></div>`;
  dom.cajaRetiroCuenta.innerHTML =
    fila("Abriste con", centsToMoney(f.fondoCentavos)) +
    fila("Cobraste en efectivo", "+" + centsToMoney(f.ventasEfectivoCentavos)) +
    fila("Pagos y retiros de hoy", centsToMoney(f.movimientosCentavos)) +
    `<div class="cierre-row cierre-row--total"><span>Deber\u00eda haber ahora</span><strong>${centsToMoney(f.esperadoCentavos)}</strong></div>`;

  const euros = parseDecimal(dom.cajaRetiroImporte.value);
  if (!Number.isFinite(euros) || euros <= 0) { dom.cajaRetiroQueda.textContent = ""; return; }
  const saca = Math.round(euros * 100);
  const queda = f.esperadoCentavos - saca;
  dom.cajaRetiroQueda.textContent = `Si sac\u00e1s ${centsToMoney(saca)}, en el caj\u00f3n quedan ${centsToMoney(queda)}.`;
  dom.cajaRetiroQueda.classList.toggle("es-negativo", queda < 0);
}

async function refrescarPasosCaja() {
  const [apertura, movimientos, totales] = await Promise.all([
    aperturaDelDia(cierreFecha),
    movimientosDelDia(cierreFecha),
    totalesDelDia(cierreFecha)
  ]);
  const vivos = movimientos.filter((m) => m.tipo !== "ajuste" || m.categoria === "apertura" ? m.tipo !== "ajuste" : true);
  renderPasoApertura(dom.cajaPasoApertura, { apertura });
  renderPasoPagos(dom.cajaPasoPagos, {
    pagos: vivos.filter((m) => m.tipo === "gasto"),
    totalCentavos: totales.gastosCentavos
  });

  const ventas = cierreDatos?.ventas || [];
  cajaFotoActual = await fotoDelCajon({ fecha: cierreFecha, ventas }).catch(() => null);
  renderPasoRetiros(dom.cajaPasoRetiros, {
    retiros: vivos.filter((m) => m.tipo === "retiro"),
    foto: cajaFotoActual
  });
}

async function renderCierreView() {
  if (!cierreFecha) cierreFecha = todayISO();
  dom.cierreDate.value = cierreFecha;
  // La vista previa del resumen es de UNA fecha puntual: al cambiar de fecha o
  // recargar la vista se cierra, para no mostrar un dia viejo.
  dom.resumenPreview.hidden = true;
  if (cierreCargando) return;
  cierreCargando = true;
  try {
    cierreDatos = await cargarCierre(cierreFecha);
    await refrescarPasosCaja().catch(() => {});
    if (currentView === "cierre") renderCierre(dom.cierreRoot, cierreDatos);
  } catch (error) {
    dom.cierreRoot.textContent = `No se pudo cargar el cierre: ${error.message || error}`;
  } finally {
    cierreCargando = false;
  }
}

function setCierreFecha(fecha) {
  if (!fecha) return;
  cierreFecha = fecha;
  renderCierreView();
}

async function handleGuardarCierre() {
  if (cierreGuardando || !cierreDatos) return;
  const r = calcularDesdeFormulario(dom.cierreRoot, cierreDatos.ventas);
  if (r.error) { setFlash(r.error, "error"); return; }
  const { calculo: c, form: f } = r;
  const resumen = c.diferenciaCentavos === 0 ? "La caja cuadra." : c.diferenciaCentavos > 0 ? `Sobran ${centsToMoney(c.diferenciaCentavos)}.` : `Faltan ${centsToMoney(-c.diferenciaCentavos)}.`;
  const confirmado = await confirmDialog({
    title: "Cerrar caja",
    message: `Cierre del ${cierreDatos.fecha}: ventas ${centsToMoney(c.ventasTotalCentavos)}, esperado en cajón ${centsToMoney(c.esperadoEfectivoCentavos)}, contado ${centsToMoney(f.contadoCentavos)}. ${resumen}${cierreDatos.vigente ? " Ya había un cierre de este día: este queda como versión nueva y el anterior se conserva." : ""}`,
    acceptText: "Cerrar caja"
  });
  if (!confirmado) return;
  cierreGuardando = true;
  try {
    await guardarCierre({
      fecha: cierreDatos.fecha,
      ventasTotalCentavos: c.ventasTotalCentavos,
      tickets: c.tickets,
      tgtgCentavos: c.tgtgCentavos,
      tgtgEnCajon: f.tgtgEnCajon,
      fondoInicialCentavos: f.fondoCentavos ?? 0,
      tarjetaCentavos: f.tarjetaCentavos,
      plataformasCentavos: f.plataformasCentavos ?? 0,
      retirosCentavos: f.retirosCentavos ?? 0,
      retirosNota: f.retirosNota,
      contadoCentavos: f.contadoCentavos,
      fondoMananaCentavos: f.fondoMananaCentavos,
      esperadoEfectivoCentavos: c.esperadoEfectivoCentavos,
      diferenciaCentavos: c.diferenciaCentavos,
      nota: f.nota
    });
    setFlash(`Caja cerrada. ${resumen}`, c.nivel === "grande" ? "warning" : "success");
    await renderCierreView();
  } catch (error) {
    setFlash(error.message || "No se pudo guardar el cierre.", "error");
  } finally {
    cierreGuardando = false;
  }
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
    const sale = await confirmSale(items, formaPagoActual);
    cart.clear();
    resetVuelto();
    setSaleMessage(
      sale.saleMode === "togoo" ? `Venta ToGoo #${sale.saleId} confirmada.` : `Venta #${sale.saleId} confirmada.`,
      true
    );
    setCartMode("normal");
    setFormaPago("efectivo");
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
  } catch (error) {
    await renderCashier();
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
  dom.pagoFormaEfectivo.addEventListener("click", () => setFormaPago("efectivo"));
  dom.pagoFormaTarjeta.addEventListener("click", () => setFormaPago("tarjeta"));
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
          // Antes decia "leche: quedaria en -150ml", que describe el sintoma.
          // Lo que la persona necesita saber es QUE le falta cargar y CUANTO,
          // en la unidad en que lo compra ("1 botella"), no en la base.
          const envaseDe = (f) => ({ nombre: f.unidadCompra, equivale: f.factorConversion });
          const lineas = faltantes.map((f) => {
            const tenes = formatearConEnvase(f.stockActual, f.unidad, envaseDe(f));
            const falta = formatearConEnvase(f.falta, f.unidad, envaseDe(f));
            return `${f.nombre}: tenés ${tenes} y te faltan ${falta}.`;
          });
          dom.insumoWarningText.textContent =
            `Esta producción necesita más de lo que tenés cargado.\n\n${lineas.join("\n")}\n\n` +
            `Si ya lo compraste y no lo cargaste, tocá "Actualizar stock". Si producís igual, el stock queda en negativo hasta que lo cargues.`;
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
    // Se limpia YA, no al final — si no, una compra de insumo totalmente
    // distinta y posterior (con la cola de faltantes vacia) dispararia por
    // error esta MISMA produccion de nuevo (ver el auto-reintento agregado
    // en el submit de insumosAjusteForm).
    pendingProduction = null;
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
    // OJO: closeInsumoWarningSheet() pone pendingProduction en null por su
    // cuenta (codigo viejo) — hay que guardarlo ANTES de llamarla, no
    // despues, o siempre se lee null y no se abre nada.
    const pending = pendingProduction;
    // A proposito NO navega a Gestion — la hoja de "Registrar" es un overlay
    // global (ver index.html), se abre encima de Produccion sin cambiar de
    // pestaña. pendingProduction se vuelve a guardar aca (closeInsumoWarningSheet
    // ya lo limpio): una vez que se termine de cargar toda la cola de
    // faltantes, el submit de insumosAjusteForm reintenta esta MISMA
    // produccion sola, sin que el usuario tenga que volver a tocar nada.
    closeInsumoWarningSheet();
    closeProductionSheet();
    if (pending && pending.faltantes.length > 0) {
      pendingProduction = pending;
      colaFaltantesInsumos = pending.faltantes.slice();
      await abrirSiguienteFaltanteInsumo();
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
  dom.menuCombosGuardar.addEventListener("click", handleGuardarCombosConfig);

  // Enlaces entre pantallas que son el mismo dato visto de otra manera. No
  // cambian nada: solo llevan ahi y dejan la seccion abierta, para que se vea
  // que estan conectadas.
  dom.irARecetas?.addEventListener("click", () => {
    setMenuEditSheetOpen(false);
    showGestionSubView("recetas");
  });
  dom.irAInsumosDesdeVariantes?.addEventListener("click", () => {
    setVarianteGrupoSheetOpen(false);
    showGestionSubView("insumos");
  });
  dom.avisoCiclo?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-accion]");
    if (!btn) return;
    const article = btn.closest(".pendiente");
    if (btn.dataset.accion === "descartar") descartarPendienteCiclo(article);
    else if (btn.dataset.accion === "guardar") guardarPendienteCiclo(article);
  });

  dom.seccionCalibracion?.addEventListener("toggle", () => {
    if (dom.seccionCalibracion.open) renderCalibracionView();
  });
  dom.historyFilter.addEventListener("submit", (event) => {
    event.preventDefault();
    renderHistoryView();
  });

  // "Ver resumen": muestra el cierre en pantalla en vez de descargar directo
  // — la descarga queda como boton aparte adentro del panel.
  dom.exportSalesSummary.addEventListener("click", async () => {
    const fecha = fechaDelCierre();
    dom.resumenPreviewText.textContent = "Cargando...";
    dom.resumenPreview.hidden = false;
    try {
      const texto = await buildSalesSummaryText(fecha);
      dom.resumenPreviewText.textContent = texto.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    } catch (error) {
      dom.resumenPreviewText.textContent = `No se pudo armar el resumen: ${error.message || error}`;
    }
  });

  dom.resumenPreviewDownload.addEventListener("click", async () => {
    await exportSalesSummary(fechaDelCierre());
    setFlash("Resumen TXT exportado.", "success");
  });

  dom.resumenPreviewClose.addEventListener("click", () => {
    dom.resumenPreview.hidden = true;
  });

  // Hasta ahora esta funcion existia en backup.js pero no tenia boton en
  // ninguna pantalla: estaba escrita, andando, e inalcanzable.
  dom.exportBackupCompleto.addEventListener("click", async () => {
    try {
      await exportFullBackup();
      setFlash("Respaldo completo descargado.", "success");
    } catch (error) {
      setFlash(error.message || "No se pudo generar el respaldo.", "error");
    }
  });

  dom.exportSalesJson.addEventListener("click", async () => {
    await exportDailySummaryJSON(fechaDelCierre());
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

  dom.insumosOrden?.addEventListener("change", () => { renderInsumosView(); });
  dom.closeInsumosAjuste.addEventListener("click", closeInsumoAjusteSheet);
  dom.insumosAjusteBackdrop.addEventListener("click", closeInsumoAjusteSheet);
  dom.closeCalibracion.addEventListener("click", closeCalibracionSheet);
  dom.calibracionBackdrop.addEventListener("click", closeCalibracionSheet);

  dom.insumosAjusteTipoCompra.addEventListener("click", () => setInsumosAjusteTipo("compra"));
  dom.insumosAjusteTipoAjuste.addEventListener("click", () => setInsumosAjusteTipo("ajuste"));

  // Los botones +/- se mueven en la unidad que se esta viendo: en g suman de a
  // 100 g, pero si el selector esta en kg no tiene sentido sumar 0,1 kg de a
  // pasos invisibles — el paso se convierte a la unidad en pantalla.
  const pasoEnPantalla = () => {
    const pasoBase = getInsumoStep(selectedInsumo);
    const enPantalla = desdeBase(pasoBase, dom.insumosAjusteUnidad.value, selectedInsumo.unidad);
    return enPantalla > 0 ? enPantalla : pasoBase;
  };
  const moverStepper = (signo) => {
    if (!selectedInsumo) return;
    const cur = parseFloat(String(dom.insumosAjusteCantidad.value).replace(",", ".")) || 0;
    const siguiente = Math.max(0, cur + signo * pasoEnPantalla());
    dom.insumosAjusteCantidad.value = paraInput(siguiente);
    updateAjusteDeltaHint(selectedInsumo);
  };
  dom.insumosAjusteMinus.addEventListener("click", () => moverStepper(-1));
  dom.insumosAjustePlus.addEventListener("click", () => moverStepper(1));

  dom.insumosAjusteCantidad.addEventListener("input", () => updateAjusteDeltaHint(selectedInsumo));
  dom.insumosCompraCantidad.addEventListener("input", () => updateCompraEquivale(selectedInsumo));
  // Cambiar de unidad convierte lo que ya estaba escrito, no lo reinterpreta:
  // 1500 g pasa a 1,5 kg, no a 1500 kg.
  // Mismo comportamiento en calibracion y receta: cambiar de unidad convierte
  // lo escrito, y debajo del campo se confirma en cuanto queda.
  const conectarSelectorUnidad = (input, select, equivale, getContexto) => {
    const refrescar = () => {
      const { base, envase } = getContexto();
      if (!base || !equivale) return;
      const valor = cantidadEnBase(input, select, base, envase);
      equivale.textContent = Number.isFinite(valor) && valor > 0 && select.value !== base
        ? `= ${formatearCantidad(valor, base, { unidad: base })}`
        : "";
    };
    input.addEventListener("input", refrescar);
    select.addEventListener("change", (e) => {
      const { base, envase } = getContexto();
      const anterior = e.target.dataset.unidadPrevia || base;
      const valor = parseFloat(String(input.value).replace(",", "."));
      if (Number.isFinite(valor)) input.value = paraInput(desdeBase(aBase(valor, anterior, base, envase), e.target.value, base, envase));
      e.target.dataset.unidadPrevia = e.target.value;
      refrescar();
    });
  };
  conectarSelectorUnidad(dom.calibracionCantidad, dom.calibracionUnidad, dom.calibracionEquivale,
    () => ({ base: selectedInsumo?.unidad, envase: envaseDeInsumo(selectedInsumo) }));
  conectarSelectorUnidad(dom.recetaEditCantidad, dom.recetaEditUnidad, dom.recetaEditEquivale,
    () => ({ base: recetaEditUnidadBase, envase: recetaEditEnvase }));

  dom.insumosAjusteUnidad.addEventListener("change", (e) => {
    if (!selectedInsumo) return;
    const anterior = e.target.dataset.unidadPrevia || selectedInsumo.unidad;
    const valor = parseFloat(String(dom.insumosAjusteCantidad.value).replace(",", "."));
    if (Number.isFinite(valor)) {
      const env = envaseDeInsumo(selectedInsumo);
      const base = aBase(valor, anterior, selectedInsumo.unidad, env);
      dom.insumosAjusteCantidad.value = paraInput(desdeBase(base, e.target.value, selectedInsumo.unidad, env));
    }
    e.target.dataset.unidadPrevia = e.target.value;
    updateAjusteDeltaHint(selectedInsumo);
  });

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
        const nuevoStock = cantidadEnBase(dom.insumosAjusteCantidad, dom.insumosAjusteUnidad, insumo.unidad, envaseDeInsumo(insumo));
        if (!Number.isFinite(nuevoStock) || nuevoStock < 0) throw new Error("Ingresa un stock valido.");
        delta = parseFloat((nuevoStock - insumo.stockActual).toFixed(4));
        if (delta === 0) throw new Error("El stock no cambio. Modificá la cantidad para registrar el ajuste.");
        tipoGuardar = dom.insumosAjusteMotivos.querySelector("input[name='insumo-motivo']:checked")?.value;
        if (!tipoGuardar) throw new Error("Seleccioná el motivo del ajuste.");
      }
      await ajustarStockInsumo(selectedInsumoId, delta, tipoGuardar);
      const msgs = { compra: "Compra registrada", desperdicio: "Baja registrada", no_recibido: "Corrección registrada", error_conteo: "Corrección registrada" };
      setFlash(`${msgs[tipoGuardar] ?? "Ajuste registrado"}: ${insumo.nombre}.`, "success");
      // Si viniamos de "Falta stock de insumos" con mas de uno faltante, no
      // se cierra la hoja — se abre directo el siguiente de la cola, para
      // cargarlos todos seguidos sin volver a buscar cada uno en el menu.
      const huboSiguiente = await abrirSiguienteFaltanteInsumo();
      if (!huboSiguiente) {
        // OJO: closeInsumoAjusteSheet() pone pendingProduction en null por
        // su cuenta (para el caso "cancelar a mitad de camino") — hay que
        // guardarlo ANTES de llamarla, no despues, o siempre se lee null.
        const pending = pendingProduction;
        closeInsumoAjusteSheet();
        // Se termino de cargar toda la cola de faltantes — si esto arranco
        // desde "Falta stock de insumos" en Produccion, reintenta esa MISMA
        // produccion sola, sin que el usuario tenga que volver a tocar nada
        // ni cambiar de pestaña (ver dom.insumoWarningUpdate).
        if (pending) {
          try {
            await commitProduction(pending.productId, pending.quantityRaw);
          } catch (error) {
            setFlash(error.message, "error");
          }
        }
        await renderInsumosView();
      }
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
      // Lo contado puede venir en kg o L: se guarda siempre en la unidad base.
      const contadoBase = cantidadEnBase(dom.calibracionCantidad, dom.calibracionUnidad, selectedInsumo?.unidad || "g", envaseDeInsumo(selectedInsumo));
      await calibrarInsumo(selectedInsumoId, contadoBase, calibracionAlphaReceta);
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
        unidadCompra: dom.crearInsumoEnvase.value,
        factorConversion: dom.crearInsumoEnvaseTrae.value,
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
      const cantidadBase = cantidadEnBase(dom.recetaEditCantidad, dom.recetaEditUnidad, recetaEditUnidadBase, recetaEditEnvase);
      await actualizarReceta(selectedRecetaId, cantidadBase, dom.recetaEditMotivo.value);
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

  dom.provProdInsumo.addEventListener("change", () => { refrescarProvProdReceta().catch(() => {}); });

  // Los dos campos de los que sale el texto de los labels de cantidad. En vivo:
  // la persona escribe el nombre, despues la unidad, y despues baja a cargar
  // las cantidades — si el label solo se armara al abrir la sheet, llegaria
  // tarde.
  dom.provProdUnidad.addEventListener("input", updateProvProdCantidadLabel);
  dom.provProdNuevoUnidad.addEventListener("input", () => {
    updateProvProdCantidadLabel();
    updateProvProdRecetaCantidadLabel();
  });

  dom.provProdRecetaRows.addEventListener("change", (e) => {
    const chk = e.target.closest(".receta-sel-check");
    if (!chk) return;
    // Desmarcar una receta que YA existe borra la linea: va por otro camino,
    // con confirmacion, y se aplica al instante.
    if (chk.dataset.ya === "1" && !chk.checked) { quitarRecetaExistente(chk.dataset.productoId, chk); return; }
    setProvProdRecetaProducto(chk.dataset.productoId, chk.checked);
    pintarProvProdRecetaSeleccion();
  });

  dom.provProdRecetaRows.addEventListener("click", (e) => {
    const chip = e.target.closest('[data-action="toggle-categoria"]');
    if (chip) {
      const grupo = dom.provProdRecetaRows.querySelector(`details[data-grupo="${chip.dataset.grupo}"]`);
      if (!grupo) return;
      const ids = [...grupo.querySelectorAll(".receta-sel-check")]
        .filter((c) => c.dataset.ya !== "1")
        .map((c) => c.dataset.productoId);
      if (!ids.length) return;
      // Acumulativo: el chip solo toca su categoria, nunca borra lo marcado en
      // otra. Si ya estaban todos, el segundo toque los suelta.
      const todos = ids.every((id) => provProdRecetaVinculos.some((v) => v.productoId === id));
      for (const id of ids) setProvProdRecetaProducto(id, !todos);
      if (!todos) grupo.open = true; // abierto para poder desmarcar los que no van
      pintarProvProdRecetaSeleccion();
      return;
    }
    if (e.target.closest('[data-action="limpiar-seleccion"]')) {
      provProdRecetaVinculos = [];
      pintarProvProdRecetaSeleccion();
    }
  });

  dom.provEditEntrega.addEventListener("click", (event) => {
    const btn = event.target.closest(".dia-btn");
    if (btn) btn.classList.toggle("active");
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
        diasCiclo: Number(dom.provEditDias.value) || 7,
        // Un lead time de 0 es un valor legitimo (cash&carry: vas y traes), asi
        // que no se puede usar `|| 0` sobre un NaN y quedarse tranquilo: se
        // valida aparte y un campo vacio se lee como 0.
        leadTimeDias: Math.max(0, Math.round(Number(dom.provEditLead.value) || 0)),
        diasEntrega: leerDiasEntrega()
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

      // Una sola cantidad para todos los productos marcados: si el insumo va en
      // los 12 sandwiches es la misma, y pedirla 12 veces no tenia sentido.
      // Cada una se puede afinar despues en Gestion > Recetas.
      const productosMarcados = provProdRecetaVinculos
        .map((v) => v.productoId)
        .filter((id) => id && !provProdRecetaYaEnReceta.has(id));
      const recetaCantidad = parseDecimal(dom.provProdRecetaCantidad.value);
      if (productosMarcados.length > 0 && !(recetaCantidad > 0)) {
        throw new Error(`Marcaste ${productosMarcados.length} producto${productosMarcados.length === 1 ? "" : "s"} para la receta: poné cuánto lleva una unidad.`);
      }
      const recetasVinculadas = productosMarcados.map((productoId) => ({ productoId, cantidad: recetaCantidad }));

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
          recetasVinculadas
        } : {})
      });

      // Insumo que ya existia: saveProveedorInsumo solo engancha recetas cuando
      // crea el insumo, asi que las altas van aparte con crearLineaReceta (que
      // ya sube su snapshot de recetas).
      if (!esInsumoNuevo && insumoId) {
        for (const linea of recetasVinculadas) {
          await crearLineaReceta({ productoId: linea.productoId, insumoId, cantidadPorUnidad: linea.cantidad });
        }
      }

      const sufijoReceta = recetasVinculadas.length
        ? ` Se agregó a la receta de ${recetasVinculadas.length} producto${recetasVinculadas.length === 1 ? "" : "s"}.`
        : "";
      setFlash((provProdMode === "edit" ? "Producto actualizado." : "Producto agregado.") + sufijoReceta, "success");
      closeProvProd();
      await renderProveedoresView();
    } catch (error) {
      setFlash(error.message || "No se pudo guardar.", "error");
    } finally {
      provProdInProgress = false;
    }
  });

  dom.closeMenuEdit.addEventListener("click", closeMenuEdit);
  dom.menuEditEliminar.addEventListener("click", handleEliminarProducto);
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
    if (e.target.classList.contains("menu-receta-nuevo-prov-nombre")) menuRecetaLineas[idx].nuevoProveedorProducto = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-prov-unidad")) menuRecetaLineas[idx].nuevoProveedorUnidad = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-prov-trae")) menuRecetaLineas[idx].nuevoProveedorTrae = e.target.value;
    if (e.target.classList.contains("menu-receta-nuevo-prov-precio")) menuRecetaLineas[idx].nuevoProveedorPrecio = e.target.value;
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
    // Elegir proveedor despliega sus tres campos, asi que hay que repintar.
    if (e.target.classList.contains("menu-receta-nuevo-proveedor")) {
      menuRecetaLineas[idx].nuevoProveedorId = e.target.value;
      // El nombre con el que figura en la factura arranca igual al del insumo:
      // es lo mas probable, y si no se corrige ahi mismo. Vacio obligaria a
      // escribirlo dos veces en el caso normal.
      if (e.target.value && !menuRecetaLineas[idx].nuevoProveedorProducto) {
        menuRecetaLineas[idx].nuevoProveedorProducto = menuRecetaLineas[idx].nuevoNombre || "";
      }
      renderMenuRecetaEditorView();
    }
    // Al salir del campo de cantidad se recalcula el minimo sugerido.
    if (e.target.classList.contains("menu-receta-cantidad")) renderMenuRecetaEditorView();
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
      const cursoresPrevios = novedadesUltimo.cursoresNuevos;
      const resultado = await pullCatalogoCompleto();
      await marcarNovedadesTraidas(cursoresPrevios);
      novedadesUltimo = { total: 0, texto: "", cursoresNuevos: null };
      renderNovedadesBadge();
      await refreshGestionSubView(currentGestionSubView);
      setRefrescarCatalogoEstado(
        "success",
        `Catalogo actualizado: ${resultado.catalogo.productos} productos, ${resultado.insumosCount} insumos, ${resultado.proveedoresResult.proveedores} proveedores` +
        (resultado.stockInsumos.corregidos.length > 0 ? `, stock alineado con la nube en ${resultado.stockInsumos.corregidos.length} insumo${resultado.stockInsumos.corregidos.length === 1 ? "" : "s"}` : "") +
        (resultado.stockProductos.corregidos.length > 0 ? `, ${resultado.stockProductos.corregidos.length} producto${resultado.stockProductos.corregidos.length === 1 ? "" : "s"}` : "") +
        (resultado.stockInsumos.omitido === "pendientes" ? " (stock sin alinear: hay operaciones sin sincronizar)" : "") +
        (resultado.variantesResult.aplicado ? `, ${resultado.variantesResult.grupos} grupo${resultado.variantesResult.grupos === 1 ? "" : "s"} de variante` : "") +
        // Un producto que desaparece de la pantalla tiene que decirse: lo
        // eliminaron desde otro dispositivo, no es un error de esta.
        (resultado.catalogo.podados.length > 0 ? `. Se ${resultado.catalogo.podados.length === 1 ? "quito 1 producto eliminado" : `quitaron ${resultado.catalogo.podados.length} productos eliminados`} desde otro dispositivo` : "") +
        "."
      );
    } catch (error) {
      setRefrescarCatalogoEstado("error", error.message || "No se pudo actualizar el catalogo (revisa la conexion).");
    } finally {
      refrescarCatalogoInProgress = false;
    }
  });

  dom.cierreDate.addEventListener("change", () => setCierreFecha(dom.cierreDate.value));
  // --- Los cuatro pasos del día: apertura, pagos, retiros, cierre ---------
  //
  // Un boton por intencion en vez de uno generico con tres opciones: el dueño
  // no piensa "voy a anotar un movimiento de tipo gasto", piensa "pagué la
  // verdura". La sheet que se abre ya es la correcta.

  // Paso 1: abrir caja.
  dom.cajaPasoApertura.addEventListener("click", async (event) => {
    const abrir = event.target.closest("#caja-abrir");
    const corregir = event.target.closest("#caja-corregir-apertura");
    if (corregir) {
      const actual = await aperturaDelDia(cierreFecha);
      const texto = window.prompt("¿Con cuánta plata abriste? (€)", centavosAInput(actual?.fondoInicialCentavos ?? 0));
      if (texto === null) return;
      const euros = parseDecimal(texto);
      if (!Number.isFinite(euros) || euros < 0) { setFlash("Poné un importe válido.", "error"); return; }
      try {
        await abrirCaja({ fondoInicialCentavos: Math.round(euros * 100), fecha: cierreFecha });
        setFlash("Fondo de apertura corregido.", "success");
        await refrescarPasosCaja();
      } catch (e) { setFlash(e.message || "No se pudo corregir.", "error"); }
      return;
    }
    if (!abrir || cajaMovEnCurso) return;
    const euros = parseDecimal(document.querySelector("#caja-apertura-monto")?.value);
    if (!Number.isFinite(euros) || euros < 0) { setFlash("Poné con cuánta plata abrís, aunque sea 0.", "error"); return; }
    try {
      cajaMovEnCurso = true;
      await abrirCaja({ fondoInicialCentavos: Math.round(euros * 100), fecha: cierreFecha });
      setFlash("Caja abierta.", "success");
      await refrescarPasosCaja();
      await renderCierreView();
    } catch (error) {
      setFlash(error.message || "No se pudo abrir la caja.", "error");
    } finally { cajaMovEnCurso = false; }
  });

  // Paso 2: pagos.
  dom.cajaPasoPagos.addEventListener("click", async (event) => {
    if (event.target.closest("#caja-nuevo-pago")) {
      dom.cajaPagoForm.reset();
      dom.cajaPagoForma.querySelectorAll(".tipo-btn").forEach((b, i) => b.classList.toggle("active", i === 0));
      // Los proveedores que ya existen, como sugerencia: no hace falta
      // escribir "Delicias Vegetales" entero cada vez.
      const proveedores = await getAll("proveedores").catch(() => []);
      dom.cajaPagoProveedores.innerHTML = proveedores
        .filter((x) => x.activo !== false)
        .map((x) => `<option value="${String(x.nombre).replace(/"/g, "&quot;")}"></option>`).join("");
      setSheetOpen(dom.cajaPagoSheet, dom.cajaPagoBackdrop, true);
      dom.cajaPagoImporte.focus();
      return;
    }
    await manejarAnular(event);
  });
  dom.closeCajaPago.addEventListener("click", () => setSheetOpen(dom.cajaPagoSheet, dom.cajaPagoBackdrop, false));
  dom.cajaPagoBackdrop.addEventListener("click", () => setSheetOpen(dom.cajaPagoSheet, dom.cajaPagoBackdrop, false));
  dom.cajaPagoForma.addEventListener("click", (e) => {
    const btn = e.target.closest(".tipo-btn");
    if (btn) dom.cajaPagoForma.querySelectorAll(".tipo-btn").forEach((b) => b.classList.toggle("active", b === btn));
  });

  dom.cajaPagoForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (cajaMovEnCurso) return;
    try {
      cajaMovEnCurso = true;
      // En centavos enteros: con flotantes, 0.1 + 0.2 no da 0.3 y eso termina
      // siendo un descuadre de caja que nadie sabe explicar.
      const euros = parseDecimal(dom.cajaPagoImporte.value);
      if (!Number.isFinite(euros) || euros <= 0) throw new Error("Poné cuánto pagaste.");
      const concepto = dom.cajaPagoConcepto.value.trim();
      if (!concepto) throw new Error("Escribí qué compraste, aunque sea corto.");
      await anotarPago({
        importeCentavos: Math.round(euros * 100),
        concepto,
        aQuien: dom.cajaPagoQuien.value,
        enEfectivo: formaPagoElegida() === "efectivo",
        fecha: cierreFecha
      });
      setFlash("Pago anotado.", "success");
      setSheetOpen(dom.cajaPagoSheet, dom.cajaPagoBackdrop, false);
      await refrescarPasosCaja();
      await renderCierreView();
    } catch (error) {
      setFlash(error.message || "No se pudo anotar.", "error");
    } finally { cajaMovEnCurso = false; }
  });

  // Paso 3: retiros, con el mini cierre.
  dom.cajaPasoRetiros.addEventListener("click", async (event) => {
    if (event.target.closest("#caja-nuevo-retiro")) {
      dom.cajaRetiroForm.reset();
      pintarCuentaRetiro();
      setSheetOpen(dom.cajaRetiroSheet, dom.cajaRetiroBackdrop, true);
      dom.cajaRetiroImporte.focus();
      return;
    }
    await manejarAnular(event);
  });
  dom.closeCajaRetiro.addEventListener("click", () => setSheetOpen(dom.cajaRetiroSheet, dom.cajaRetiroBackdrop, false));
  dom.cajaRetiroBackdrop.addEventListener("click", () => setSheetOpen(dom.cajaRetiroSheet, dom.cajaRetiroBackdrop, false));
  // "Se retiró tanto, queda tanto": el numero se actualiza mientras se tipea,
  // que es cuando sirve para decidir cuanto sacar.
  dom.cajaRetiroImporte.addEventListener("input", pintarCuentaRetiro);

  dom.cajaRetiroForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (cajaMovEnCurso) return;
    try {
      cajaMovEnCurso = true;
      const euros = parseDecimal(dom.cajaRetiroImporte.value);
      if (!Number.isFinite(euros) || euros <= 0) throw new Error("Poné cuánto sacás.");
      const motivo = dom.cajaRetiroMotivo.value.trim();
      if (!motivo) throw new Error("Escribí para qué lo sacás.");
      await anotarRetiro({ importeCentavos: Math.round(euros * 100), motivo, fecha: cierreFecha });
      setFlash("Retiro anotado.", "success");
      setSheetOpen(dom.cajaRetiroSheet, dom.cajaRetiroBackdrop, false);
      await refrescarPasosCaja();
      await renderCierreView();
    } catch (error) {
      setFlash(error.message || "No se pudo anotar el retiro.", "error");
    } finally { cajaMovEnCurso = false; }
  });

  dom.cierrePrev.addEventListener("click", () => setCierreFecha(sumarDias(cierreFecha || todayISO(), -1)));
  dom.cierreNext.addEventListener("click", () => setCierreFecha(sumarDias(cierreFecha || todayISO(), 1)));
  dom.cierreHoy.addEventListener("click", () => setCierreFecha(todayISO()));
  dom.cierreRoot.addEventListener("click", (e) => { if (e.target.closest("#cierre-guardar")) handleGuardarCierre(); });

  dom.panelDate.addEventListener("change", () => setPanelFecha(dom.panelDate.value));
  dom.panelPrev.addEventListener("click", () => setPanelFecha(sumarDias(panelFecha || todayISO(), -1)));
  dom.panelNext.addEventListener("click", () => setPanelFecha(sumarDias(panelFecha || todayISO(), 1)));
  dom.panelHoy.addEventListener("click", () => setPanelFecha(todayISO()));
  dom.panelRefresh.addEventListener("click", () => renderPanelView());

  window.addEventListener("hashchange", () => {
    const viewName = window.location.hash.replace("#", "") || "caja";
    if (["caja", "pedidos", "produccion", "historial", "panel", "cierre", "gestion"].includes(viewName)) showView(viewName);
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


// Reloj simulado (solo local/staging, ver format.js) — recarga la pagina
// entera al avanzar el dia a proposito: es una herramienta de prueba, no
// una feature de UX, asi que preferimos la garantia de "todo se vuelve a
// calcular de cero contra la fecha nueva" por sobre la suavidad de refrescar
// sin recargar.
function setupRelojSimulado() {
  const esLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!esLocal) return;
  dom.relojSimulado.hidden = false;
  dom.relojSimuladoFecha.textContent = todayISO();
  dom.relojSimuladoAvanzar.addEventListener("click", () => {
    avanzarFechaSimulada();
    window.location.reload();
  });
}

async function bootApp() {
  await seedDatabase();
  await seedInsumos();
  await seedProveedores();
  await initModoConsultaDefault();
  await refreshGruposVariantes();
  // Antes de que Caja/Pedidos calculen ningun precio de combo (docena/media
  // docena) — si nunca se edito, pricing.js ya arranca con el default de
  // siempre, esto solo aplica lo que este dispositivo tenga guardado.
  await cargarCombosConfigLocal();
  setupAutoSync();
  setupSyncBadge();
  setupNovedades();
  setupAvisosPedidos();
  // Sin await: si tarda o falla (sin internet), no puede demorar el arranque.
  inicializarNovedadesSiHaceFalta().then(revisarNovedadesAhora).catch(() => {});
  revisarAvisosPedidos().catch(() => {});
  // Subir catalogo/insumos/recetas/proveedores a Supabase al arrancar
  // (upsert idempotente) — la lectura de facturas necesita esto del lado
  // del servidor, no solo la tablet lo usa mas.
  //
  // El ORDEN importa y hay que respetarlo: recetas tiene FK a productos, y
  // proveedor_insumos tiene FK a insumos Y a proveedores — pushear todo en
  // paralelo sin esperar arriesga un 409 (la fila con la que se relaciona
  // todavia no llego del otro lado) en cualquier base que arranque vacia,
  // como la de staging (confirmado 23/09/2026). En produccion nunca se
  // noto porque productos/insumos/proveedores ya existian ahi desde antes
  // de que este codigo se escribiera — nunca se dio la carrera de verdad.
  //
  // Un dispositivo en modo consulta NO sube nada al arrancar: solo mira. Si
  // subiera su copia local (vieja, o vacia si es nuevo) pisaria definiciones
  // de insumos/recetas editadas desde otro lado.
  const subidaDeArranque = (async () => {
    if (isModoConsulta()) return;
    try {
      const [categorias, productos] = await Promise.all([getAll("categorias"), getAll("productos")]);
      await trySyncCatalogoSnapshot(categorias, productos).catch(() => {});

      const [insumos, proveedores] = await Promise.all([getAll("insumos"), getAll("proveedores")]);
      await Promise.all([
        trySyncInsumosSnapshot(insumos).catch(() => {}),
        trySyncProveedoresSnapshot(proveedores).catch(() => {})
      ]);

      const [recetasLocales, proveedorInsumos] = await Promise.all([getAll("recetas"), getAll("proveedor_insumos")]);
      // Las recetas se mandan en UN solo lote: una sola que apunte a un
      // producto que no existe (ej. una receta huerfana del seed) hace fallar
      // el lote entero con un 409 y NINGUNA receta llega a Supabase. Solo se
      // suben las que apuntan a un producto real.
      const idsProductos = new Set(productos.map((p) => p.id));
      const recetas = recetasLocales.filter((r) => idsProductos.has(r.productoId));
      await Promise.all([
        trySyncRecetasSnapshot(recetas).catch(() => {}),
        trySyncProveedorInsumosSnapshot(proveedorInsumos).catch(() => {})
      ]);
    } catch { /* fire-and-forget: nunca bloquea el arranque de la app */ }
  })();
  // Auto-sync silencioso al abrir la app (ver sincronizarCatalogoSilencioso).
  // Sin await a proposito: no puede demorar el primer render (offline-first).
  // El carrito de Caja siempre arranca vacio en este momento, asi que no
  // existe el riesgo de precio-visto-vs-precio-cobrado que si aplicaria si
  // esto corriera con una venta ya empezada.
  // Corre DESPUES de la subida de arranque: mientras haya operaciones sin
  // subir, la alineacion del stock con la nube se salta a proposito (nunca
  // pisar algo que la nube todavia no vio) y el dispositivo quedaria con el
  // stock viejo hasta la proxima vez que se abra Gestion.
  subidaDeArranque.then(() => sincronizarCatalogoSilencioso());
  dom.historyDate.value = todayISO();
  bindEvents();
  const initialView = window.location.hash.replace("#", "") || "caja";
  showView(["caja", "pedidos", "produccion", "historial", "panel", "cierre", "gestion"].includes(initialView) ? initialView : "caja");
}

export async function startApp() {
  setupRelojSimulado();
  bindAuthEvents();
  const session = await restoreSession();
  if (session) {
    hideLoginScreen();
    await bootApp();
  } else {
    showLoginScreen();
  }
}
