// El estado de un insumo deja de ser "cuánto queda" y pasa a ser
// "¿llego con esto hasta que entre el próximo pedido?".
//
// Antes era una comparación contra un número fijo:
//
//   estadoStock: stockActual <= stockCritico ? "critico"
//              : stockActual <= stockMinimo  ? "bajo" : "ok"
//
// Sin ninguna noción de tiempo. Por eso el café decía "bajo" con 790 g, aunque
// consumiendo 146 g/día eso sean 5,4 días y el próximo pedido entre el martes:
// no hay ningún problema, pero el semáforo te hacía comprar por miedo. Y al
// revés: un insumo podía estar "ok" y no llegar, porque el proveedor tarda 5
// días y nadie lo estaba contando.
//
// Acá se junta todo lo que ya sabemos: cuánto consume de verdad (con su patrón
// por día de la semana — un sábado consume 1,24 y un domingo 0,66), cuándo
// entra el próximo pedido (lead time y días fijos de entrega del proveedor) y
// los pedidos de clientes ya cargados, que son demanda que YA sabemos que
// viene.
//
// Funciones puras, sin IndexedDB y sin red: así se prueban sin navegador.

import {
  ventanaDeCobertura,
  diasDeStock,
  demandaEnVentana,
  tasaBaseDiaria,
  perfilSemanal,
  perfilSemanalDelLocal,
  perfilSemanalMezclado,
  alphaDiariaDesde,
  sumarDias
} from "./compras-calculos.js";

// Los movimientos que son CONSUMO. Una compra suma stock y no dice nada sobre
// lo que se gasta por día; una calibración es una corrección de conteo, no
// consumo real. Meterlas en la serie ensuciaría la tasa.
const TIPOS_DE_CONSUMO = new Set(["venta", "produccion", "desperdicio"]);

// De los movimientos crudos a una serie diaria por insumo, en unidad base.
//
// Los días sin consumo tienen que estar con cantidad 0, no faltar: la ausencia
// de la fila ES información (ese domingo se vendió poco). Si solo se guardaran
// los días con movimiento, el promedio saldría inflado.
export function serieDeConsumo(movimientos, { desde, hasta }) {
  const porInsumo = new Map();
  for (const m of movimientos || []) {
    if (!TIPOS_DE_CONSUMO.has(m.tipo)) continue;
    const fecha = String(m.fecha || "").slice(0, 10);
    if (!fecha || fecha < desde || fecha > hasta) continue;
    const gastado = Math.abs(Number(m.cantidad) || 0);
    if (gastado <= 0) continue;
    if (!porInsumo.has(m.insumoId)) porInsumo.set(m.insumoId, new Map());
    const dias = porInsumo.get(m.insumoId);
    dias.set(fecha, (dias.get(fecha) || 0) + gastado);
  }

  // SOLO los dias con actividad. Rellenar con ceros todo el rango parece mas
  // prolijo y es una trampa: un hueco en la serie casi nunca significa "ese dia
  // no se consumio nada", significa "de ese dia no tenemos datos". En staging
  // hay un hueco real del 26/09 al 03/10; contarlo como ocho dias de consumo
  // cero hundia la tasa del jamon de 1190 g/dia a 340, y el modelo habria
  // pedido un tercio de lo que hace falta.
  //
  // La contrapartida, dicha de frente: la tasa queda "por dia con actividad",
  // y diasDeStock la aplica a todos los dias del calendario. Si el local cierra
  // un dia, se sobreestima el consumo y el stock parece durar menos de lo que
  // dura. Es el error que preferimos: pedir un poco antes cuesta plata quieta,
  // quedarse sin pan cuesta no tener que vender. El patron semanal corrige
  // buena parte de esto solo (un domingo pesa 0,66 y un sabado 1,24).
  const series = new Map();
  for (const [insumoId, dias] of porInsumo) {
    series.set(insumoId, [...dias.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([fecha, cantidad]) => ({ fecha, cantidad })));
  }
  return series;
}

// El proveedor por el que realmente va a entrar el pedido: el que llega
// antes. Para saber si llego no importa cuál es el más barato, importa cuál es
// el más rápido — si hay uno que te lo trae mañana, no estás en problemas
// aunque el habitual tarde una semana.
export function proveedorMasRapido(suppliers) {
  const candidatos = (suppliers || []).filter((s) => s && s.activo !== false);
  if (candidatos.length === 0) return null;
  return candidatos.reduce((mejor, s) => {
    const lead = Number(s.leadTimeDias) || 0;
    const leadMejor = Number(mejor.leadTimeDias) || 0;
    return lead < leadMejor ? s : mejor;
  });
}

// El veredicto para UN insumo.
//
// `demandaConocida` son los pedidos de clientes ya cargados para esos días, en
// unidad base. Es opcional a propósito: los pedidos viven solo en la nube (no
// hay store local), así que sin internet esto llega vacío. El estado tiene que
// seguir sirviendo igual — por eso `pedidosIncluidos` sale en el resultado,
// para poder decir en pantalla que la cuenta no los contempla en vez de
// quedarse corto en silencio.
export function estadoDeInsumo({
  insumo,
  serie,
  perfil,
  proveedor,
  hoy,
  demandaConocida = 0,
  pedidosIncluidos = false
}) {
  const alphaDiaria = alphaDiariaDesde(insumo.alphaPrediccion ?? 0.5);
  const tasaBase = tasaBaseDiaria(serie, perfil, alphaDiaria);

  // Sin proveedor cargado no hay forma de saber cuándo entra nada. No es un
  // estado de stock: es un dato que falta, y se dice así.
  if (!proveedor) {
    return {
      estado: "sin-proveedor",
      tasaBase,
      diasDeStockRestantes: diasDeStock(insumo.stockActual, hoy, tasaBase, perfil),
      porQue: "No sabemos cuándo entra: falta cargarle un proveedor."
    };
  }

  const ventana = ventanaDeCobertura({
    hoy,
    leadTimeDias: proveedor.leadTimeDias,
    diasCiclo: proveedor.diasCiclo,
    diasEntrega: proveedor.diasEntrega
  });

  // El stock que de verdad queda para el consumo de todos los días es el que
  // hay menos lo que ya está comprometido en pedidos de clientes.
  const stockLibre = Math.max(0, (Number(insumo.stockActual) || 0) - (Number(demandaConocida) || 0));
  const dias = diasDeStock(stockLibre, hoy, tasaBase, perfil);

  if (dias == null) {
    return {
      estado: "sin-datos",
      tasaBase,
      diasDeStockRestantes: null,
      ...ventana,
      pedidosIncluidos,
      porQue: "Todavía no hay consumo registrado para estimar cuánto dura."
    };
  }

  const estado = dias < ventana.diasHastaLlegada ? "no-llega"
    : dias < ventana.diasACubrir ? "justo"
    : "bien";

  return {
    estado,
    tasaBase,
    diasDeStockRestantes: dias,
    stockComprometido: Number(demandaConocida) || 0,
    pedidosIncluidos,
    ...ventana,
    demandaHastaLlegada: demandaEnVentana(hoy, ventana.diasHastaLlegada, tasaBase, perfil)
  };
}

// Todos los insumos de una, compartiendo el perfil semanal del local.
//
// El perfil se calcula una sola vez con TODOS los insumos juntos y después se
// mezcla con el de cada uno: con 15 días de historia, un insumo solo no tiene
// derecho a inventar su propio patrón semanal, pero el local entero sí tiene
// un sábado que vende más que un domingo.
export function estadoDeTodos({ insumos, movimientos, proveedoresPorInsumo, hoy, demandaPorInsumo = null, pedidosIncluidos = false, diasDeHistoria = 56 }) {
  const desde = sumarDias(hoy, -Math.abs(diasDeHistoria));
  const series = serieDeConsumo(movimientos, { desde, hasta: hoy });
  const perfilLocal = perfilSemanalDelLocal([...series.values()]);

  const resultado = new Map();
  for (const insumo of insumos || []) {
    const serie = series.get(insumo.id) || [];
    resultado.set(insumo.id, estadoDeInsumo({
      insumo,
      serie,
      perfil: serie.length > 0 ? perfilSemanalMezclado(serie, perfilLocal) : perfilLocal,
      proveedor: proveedorMasRapido(proveedoresPorInsumo?.get?.(insumo.id) ?? proveedoresPorInsumo?.[insumo.id]),
      hoy,
      demandaConocida: demandaPorInsumo?.[insumo.id]?.total ?? 0,
      pedidosIncluidos
    }));
  }
  return resultado;
}

// El texto que se lee en pantalla. Un estado sin su porqué no se puede
// discutir, y lo que el dueño necesita no es "bajo" sino "te dura hasta el
// jueves y el pedido entra el martes".
export function explicarEstado(est, { nombreDia } = {}) {
  if (!est) return "";
  if (est.porQue) return est.porQue;

  const dias = est.diasDeStockRestantes;
  const texto = dias == null ? "" : dias < 1 ? "se termina hoy"
    : dias < 2 ? "alcanza para 1 día"
    : `alcanza para ${Math.floor(dias)} días`;
  const llegada = nombreDia ? nombreDia(est.llegadaEstaOrden) : est.llegadaEstaOrden;

  if (est.estado === "no-llega") return `${texto} — no llega: si pedís hoy, entra el ${llegada}`;
  if (est.estado === "justo") return `${texto} — justo: el pedido entra el ${llegada}`;
  return `${texto} — llega bien, el pedido entra el ${llegada}`;
}
