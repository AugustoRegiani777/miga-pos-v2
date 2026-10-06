// Calculos puros del modelo de aprovisionamiento (sin red ni IndexedDB).
// Separado de aprovisionamiento.js para poder probarlo sin navegador.
//
// ---------------------------------------------------------------------------
// QUE ARREGLA ESTE MODULO
// ---------------------------------------------------------------------------
// El modelo viejo decidia cuanto pedir asi:
//
//     pedir = consumoDiario * diasCiclo + stockMinimo - stockActual
//
// y tenia cuatro agujeros, en orden de cuanta plata cuestan:
//
// 1. `diasCiclo` mezclaba DOS cosas distintas: cada cuanto hago el pedido y
//    cuanto tarda en llegar. Son independientes. Si pido cada 7 dias y tarda
//    3 en llegar, el stock de hoy tiene que aguantar 10 dias, no 7: el pedido
//    que hago hoy llega el dia 3, y el siguiente que haga (dia 7) no llega
//    hasta el dia 10. Ignorar el lead time es faltarle 30% a cada pedido, y
//    la rotura no aparece el dia del pedido sino tres dias despues, cuando ya
//    nadie la relaciona con la lista de compras.
//
// 2. Un promedio plano no sabe que un sabado se consume el doble que un
//    domingo. "Me quedan 7 dias de stock" es falso si los 2 que vienen son
//    viernes y sabado. Cubrir una ventana es sumar los dias REALES que vienen,
//    no multiplicar por una media.
//
// 3. Dias fijos de entrega. Mercadona entrega martes, miercoles y viernes.
//    Eso ya estaba anotado como texto en las notas del proveedor, o sea que
//    el modelo no lo usaba. Si hoy es jueves y entrega martes/miercoles/
//    viernes, el pedido de hoy llega el viernes y el siguiente no llega hasta
//    el martes: hay que cubrir hasta el martes.
//
// 4. `stockMinimo` era un colchon fijo escrito a mano por insumo. Un insumo
//    de consumo estable (cafe, cv 0.17) necesita mucho menos colchon que uno
//    que salta (leche sin lactosa, cv 0.74). El colchon sale de la
//    variabilidad medida, no de un numero fijo ni de un porcentaje.
//
// ---------------------------------------------------------------------------
// EL MODELO NUEVO, EN UNA LINEA
// ---------------------------------------------------------------------------
//   objetivo = demanda(hoy .. llegada del PROXIMO pedido) + z * sigma * raiz(dias)
//   pedir    = objetivo - stockActual - enTransito
//
// Es un order-up-to de revision periodica estandar. Lo unico "a medida" es
// que la demanda de la ventana se suma dia por dia con el peso del dia de la
// semana, y que la ventana la define el calendario real del proveedor.
//
// Las cantidades van siempre en la unidad BASE del insumo (g, ml, rebanada,
// unidad). Este modulo no convierte unidades: eso lo hace quien lo llama,
// dividiendo por `cantidadPorUnidad` del proveedor.

// ---------------------------------------------------------------------------
// Calendario
// ---------------------------------------------------------------------------
// Todo en UTC a proposito: las fechas del negocio son "2026-09-25", un dia
// calendario, no un instante. Usar hora local haria que el dia de la semana
// cambiara segun el huso del dispositivo.

export function sumarDias(fechaISO, dias) {
  const d = new Date(`${fechaISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// 0 = domingo ... 6 = sabado (igual que Date.getUTCDay)
export function diaSemana(fechaISO) {
  return new Date(`${fechaISO}T00:00:00Z`).getUTCDay();
}

export function diasEntre(desdeISO, hastaISO) {
  const a = new Date(`${desdeISO}T00:00:00Z`).getTime();
  const b = new Date(`${hastaISO}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86400000);
}

// Primera fecha >= desdeISO cuyo dia de la semana este en diasEntrega.
// diasEntrega vacio o nulo = entrega cualquier dia, asi que devuelve desdeISO.
export function proximaFechaEntrega(desdeISO, diasEntrega) {
  if (!Array.isArray(diasEntrega) || diasEntrega.length === 0) return desdeISO;
  const permitidos = new Set(diasEntrega.map(Number).filter((d) => d >= 0 && d <= 6));
  if (permitidos.size === 0) return desdeISO;
  for (let k = 0; k < 14; k++) {
    const f = sumarDias(desdeISO, k);
    if (permitidos.has(diaSemana(f))) return f;
  }
  return desdeISO;
}

// ---------------------------------------------------------------------------
// Ventana de cobertura: el corazon del arreglo
// ---------------------------------------------------------------------------
// Devuelve cuantos dias tiene que aguantar el stock que hay HOY mas lo que se
// pida hoy. La regla, en lenguaje del negocio:
//
//   - Con dias fijos de entrega: la ventana va de hoy hasta la SEGUNDA
//     entrega posible. La primera trae el pedido de hoy; la segunda trae el
//     siguiente. Entre una y otra no hay forma de reponer.
//   - Sin dias fijos: ventana = lead time + cada cuanto pido.
//
// `diasCiclo` queda para mostrar y para el caso sin dias fijos. Cuando el
// proveedor tiene calendario propio, el calendario manda: decir "le pido cada
// 3 dias" a un proveedor que entrega martes/miercoles/viernes es, en la
// practica, pedirle en cada entrega posible.
export function ventanaDeCobertura({ hoy, leadTimeDias = 0, diasCiclo = 7, diasEntrega = null }) {
  const lead = Math.max(0, Math.round(Number(leadTimeDias) || 0));
  const ciclo = Math.max(1, Math.round(Number(diasCiclo) || 7));
  const tieneCalendario = Array.isArray(diasEntrega) && diasEntrega.length > 0 && diasEntrega.length < 7;

  const llegadaEstaOrden = tieneCalendario
    ? proximaFechaEntrega(sumarDias(hoy, lead), diasEntrega)
    : sumarDias(hoy, lead);

  let llegadaProximaOrden;
  if (tieneCalendario) {
    llegadaProximaOrden = proximaFechaEntrega(sumarDias(llegadaEstaOrden, 1), diasEntrega);
  } else {
    llegadaProximaOrden = sumarDias(hoy, ciclo + lead);
    // Un ciclo de 0 o un lead raro no pueden dejar la ventana vacia: el
    // proximo pedido siempre llega despues de este.
    if (diasEntre(llegadaEstaOrden, llegadaProximaOrden) < 1) {
      llegadaProximaOrden = sumarDias(llegadaEstaOrden, 1);
    }
  }

  return {
    llegadaEstaOrden,
    llegadaProximaOrden,
    diasHastaLlegada: diasEntre(hoy, llegadaEstaOrden),
    diasACubrir: diasEntre(hoy, llegadaProximaOrden),
    usaCalendario: tieneCalendario
  };
}

// ---------------------------------------------------------------------------
// Demanda por dia de la semana
// ---------------------------------------------------------------------------
// `serie`: [{ fecha: "2026-09-11", cantidad: 45 }, ...] — consumo real por dia
// en unidad base. Un dia sin consumo tiene que venir con cantidad 0, no
// faltar: la ausencia de la fila es informacion (ese domingo se vendio poco).
//
// El factor de cada dia es su media dividida por la media global, encogido
// hacia 1 segun cuantas observaciones hay de ese dia. Con dos martes medidos
// no hay derecho a creerle al 100% a lo que digan esos dos martes; con diez,
// si. `pseudoObs` es cuantas observaciones imaginarias "en la media" se le
// suman a cada dia: es el freno que evita que 15 dias de historia inventen un
// patron semanal que no existe.
//
// Al final se renormaliza para que el promedio de los 7 factores sea 1, asi
// `tasaBase` se lee como "lo que consume un dia promedio".
const FACTORES_PLANOS = Object.freeze([1, 1, 1, 1, 1, 1, 1]);

export function perfilSemanal(serie, { pseudoObs = 2 } = {}) {
  const limpias = (serie || []).filter((p) => p && p.fecha && Number.isFinite(Number(p.cantidad)));
  if (limpias.length === 0) {
    return { factores: [...FACTORES_PLANOS], observaciones: [0, 0, 0, 0, 0, 0, 0], mediaGlobal: 0, dias: 0 };
  }

  const total = limpias.reduce((s, p) => s + Number(p.cantidad), 0);
  const mediaGlobal = total / limpias.length;
  const observaciones = [0, 0, 0, 0, 0, 0, 0];
  const sumas = [0, 0, 0, 0, 0, 0, 0];
  for (const p of limpias) {
    const d = diaSemana(p.fecha);
    observaciones[d] += 1;
    sumas[d] += Number(p.cantidad);
  }

  if (mediaGlobal <= 0) {
    return { factores: [...FACTORES_PLANOS], observaciones, mediaGlobal, dias: limpias.length };
  }

  const crudos = observaciones.map((n, d) => (n > 0 ? (sumas[d] / n) / mediaGlobal : 1));
  const encogidos = crudos.map((f, d) => {
    const n = observaciones[d];
    return (n * f + pseudoObs * 1) / (n + pseudoObs);
  });

  // Renormalizacion: que el promedio de la semana sea exactamente 1.
  const mediaFactores = encogidos.reduce((s, f) => s + f, 0) / 7;
  const factores = mediaFactores > 0 ? encogidos.map((f) => f / mediaFactores) : [...FACTORES_PLANOS];

  return { factores, observaciones, mediaGlobal, dias: limpias.length };
}

// El patron semanal es del LOCAL, no de cada insumo: lo que sube un sabado es
// la cantidad de gente que entra, y eso arrastra a todos los insumos a la vez.
// Estimarlo insumo por insumo con 15 dias de historia da dos martes por
// insumo y mucho ruido; estimarlo una sola vez sobre todos los insumos juntos
// da la misma cantidad de martes pero cada uno medido con mucha menos
// varianza.
//
// Para poder sumar insumos con escalas distintas (1700 ml de leche y 31
// rebanadas de miga) cada serie se normaliza por su propia media antes de
// juntarlas. Un insumo con pocos dias o media cero no aporta.
export function perfilSemanalDelLocal(seriesPorInsumo, { pseudoObs = 2, minDias = 5 } = {}) {
  const puntos = [];
  for (const serie of seriesPorInsumo || []) {
    const limpias = (serie || []).filter((p) => p && p.fecha && Number.isFinite(Number(p.cantidad)));
    if (limpias.length < minDias) continue;
    const media = limpias.reduce((s, p) => s + Number(p.cantidad), 0) / limpias.length;
    if (media <= 0) continue;
    for (const p of limpias) puntos.push({ fecha: p.fecha, cantidad: Number(p.cantidad) / media });
  }
  if (puntos.length === 0) {
    return { factores: [...FACTORES_PLANOS], observaciones: [0, 0, 0, 0, 0, 0, 0], mediaGlobal: 0, dias: 0, insumos: 0 };
  }
  const perfil = perfilSemanal(puntos, { pseudoObs });
  return { ...perfil, insumos: (seriesPorInsumo || []).length };
}

// Insumos que NO siguen el patron del local existen (el cafe es mas de
// mañana de semana que de sabado a la tarde). Esto mezcla el perfil propio
// del insumo con el del local, dandole peso al propio en proporcion a cuantos
// dias de historia tiene. Con 15 dias pesa poco; con 3 meses, pesa.
export function perfilSemanalMezclado(serieInsumo, perfilLocal, { diasParaConfiar = 56, pseudoObs = 2 } = {}) {
  const propio = perfilSemanal(serieInsumo, { pseudoObs });
  if (propio.dias === 0) return { ...perfilLocal, origen: "local" };
  const w = Math.min(1, propio.dias / Math.max(1, diasParaConfiar));
  const factores = propio.factores.map((f, d) => w * f + (1 - w) * (perfilLocal?.factores?.[d] ?? 1));
  const media = factores.reduce((s, f) => s + f, 0) / 7;
  return {
    factores: media > 0 ? factores.map((f) => f / media) : [...FACTORES_PLANOS],
    observaciones: propio.observaciones,
    mediaGlobal: propio.mediaGlobal,
    dias: propio.dias,
    pesoPropio: w,
    origen: w >= 1 ? "insumo" : w <= 0 ? "local" : "mezcla"
  };
}

// ---------------------------------------------------------------------------
// Tasa base: cuanto consume un dia promedio
// ---------------------------------------------------------------------------
// EMA sobre la serie DESESTACIONALIZADA (cada dia dividido por el factor de su
// dia de la semana). El orden importa: suavizar primero y desestacionalizar
// despues deja la media sesgada segun en que dia de la semana termina la
// historia — una EMA que cierra un domingo te dice que el negocio se murio.
//
// `alphaPorCalibracion` es el alphaPrediccion que ya elige el usuario
// (0.20 / 0.50 / 0.80). Ese numero fue pensado para una cadencia de
// calibraciones (~semanal), no diaria, asi que se convierte a su equivalente
// por dia: un 0.50 semanal es un 0.094 diario (misma vida media de 7 dias).
// De esa forma el control que ya conoce el usuario sigue significando lo
// mismo cuando el modelo pasa a leer dia por dia.
export function alphaDiariaDesde(alphaPorCalibracion, diasPorPeriodo = 7) {
  const a = Number(alphaPorCalibracion);
  if (!Number.isFinite(a) || a <= 0) return 0.1;
  if (a >= 1) return 1;
  return 1 - Math.pow(1 - a, 1 / Math.max(1, diasPorPeriodo));
}

export function tasaBaseDiaria(serie, perfil, alphaDiaria = 0.1) {
  const limpias = (serie || [])
    .filter((p) => p && p.fecha && Number.isFinite(Number(p.cantidad)))
    .slice()
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (limpias.length === 0) return 0;
  const factores = perfil?.factores ?? FACTORES_PLANOS;
  const desest = limpias.map((p) => {
    const f = factores[diaSemana(p.fecha)] || 1;
    return Number(p.cantidad) / (f > 0 ? f : 1);
  });
  // La EMA NO arranca en el primer dia. Con alpha diaria baja (que es lo
  // correcto para datos diarios) arrancar en un solo dia deja la estimacion
  // pegada a ese dia durante semanas: si el primer dia medido fue un domingo
  // flojo o un dia sin consumo, el modelo cree que el insumo no se usa y no
  // repone. Arranca en el promedio de la primera semana, que es un punto de
  // partida sin sesgo de dia.
  const arranque = Math.min(7, desest.length);
  let ema = desest.slice(0, arranque).reduce((s, x) => s + x, 0) / arranque;
  for (let k = arranque; k < desest.length; k++) ema = alphaDiaria * desest[k] + (1 - alphaDiaria) * ema;
  return Math.max(0, ema);
}

// ---------------------------------------------------------------------------
// Variabilidad: el colchon sale de aca, no de un porcentaje
// ---------------------------------------------------------------------------
// Sigma de los residuos contra la prediccion (tasaBase * factor del dia), NO
// del nivel. La diferencia es la clave de todo el punto 4: el salto
// viernes-domingo es PREDECIBLE, asi que no es riesgo y no tiene que pagar
// colchon. Lo que paga colchon es lo que queda despues de explicar el dia de
// la semana.
//
// `cvMinimo` es un piso: con pocos dias de historia sigma sale subestimada
// (incluso 0 si los dias medidos salieron parecidos), y creer que un insumo de
// comida tiene variabilidad cero es la forma mas facil de quedarse sin stock.
// No es un porcentaje de seguridad: es el minimo de incertidumbre que se le
// reconoce a una medicion corta.
export function variabilidadDiaria(serie, perfil, tasaBase, { cvMinimo = 0.12 } = {}) {
  const limpias = (serie || []).filter((p) => p && p.fecha && Number.isFinite(Number(p.cantidad)));
  const piso = Math.max(0, cvMinimo * tasaBase);
  if (limpias.length < 3 || tasaBase <= 0) {
    return { sigma: piso, cv: tasaBase > 0 ? piso / tasaBase : 0, dias: limpias.length, usoPiso: true };
  }
  const factores = perfil?.factores ?? FACTORES_PLANOS;
  let suma2 = 0;
  for (const p of limpias) {
    const esperado = tasaBase * (factores[diaSemana(p.fecha)] || 1);
    suma2 += (Number(p.cantidad) - esperado) ** 2;
  }
  const sigma = Math.sqrt(suma2 / (limpias.length - 1));
  const usoPiso = sigma < piso;
  const sigmaFinal = Math.max(sigma, piso);
  return { sigma: sigmaFinal, sigmaMedida: sigma, cv: sigmaFinal / tasaBase, dias: limpias.length, usoPiso };
}

// z para el nivel de servicio pedido. Tabla corta a proposito: son las unicas
// opciones que tiene sentido ofrecerle a alguien que decide "cuantas veces por
// año acepto quedarme sin esto".
const Z_POR_SERVICIO = { 0.80: 0.84, 0.85: 1.04, 0.90: 1.28, 0.95: 1.65, 0.975: 1.96, 0.99: 2.33 };

export function zDeServicio(nivelServicio = 0.95) {
  const n = Number(nivelServicio);
  if (!Number.isFinite(n)) return 1.65;
  let mejor = 0.95;
  for (const k of Object.keys(Z_POR_SERVICIO)) {
    if (Math.abs(Number(k) - n) < Math.abs(mejor - n)) mejor = Number(k);
  }
  return Z_POR_SERVICIO[mejor];
}

export function stockDeSeguridad({ sigmaDiaria = 0, dias = 1, nivelServicio = 0.95 }) {
  const d = Math.max(1, dias);
  return zDeServicio(nivelServicio) * Math.max(0, sigmaDiaria) * Math.sqrt(d);
}

// ---------------------------------------------------------------------------
// Demanda de una ventana concreta del calendario
// ---------------------------------------------------------------------------
// Suma dia por dia los dias que vienen de verdad. Esto es el punto 2: para
// cubrir de jueves a martes se suman jueves, viernes, sabado, domingo y lunes
// con sus pesos, no se multiplica una media por 5.
export function demandaEnVentana(desdeISO, dias, tasaBase, perfil) {
  const factores = perfil?.factores ?? FACTORES_PLANOS;
  let total = 0;
  for (let k = 0; k < Math.max(0, Math.round(dias)); k++) {
    total += tasaBase * (factores[diaSemana(sumarDias(desdeISO, k))] || 1);
  }
  return total;
}

// Cuantos dias aguanta el stock que hay, caminando el calendario real.
// Devuelve fraccion de dia y null si no hay consumo conocido.
export function diasDeStock(stockActual, desdeISO, tasaBase, perfil, maxDias = 120) {
  if (!(tasaBase > 0)) return null;
  if (stockActual <= 0) return 0;
  const factores = perfil?.factores ?? FACTORES_PLANOS;
  let resto = stockActual;
  for (let k = 0; k < maxDias; k++) {
    const consumoDia = tasaBase * (factores[diaSemana(sumarDias(desdeISO, k))] || 1);
    if (consumoDia <= 0) continue;
    if (resto < consumoDia) return Math.round((k + resto / consumoDia) * 10) / 10;
    resto -= consumoDia;
  }
  return maxDias;
}

// ---------------------------------------------------------------------------
// La decision de compra
// ---------------------------------------------------------------------------
// Devuelve TODO lo que se uso para decidir, no solo el numero: el dueño tiene
// que poder ver por que la app le pide 7 kg y no 4. Un numero sin su porque
// no se puede discutir, y una lista de compras que no se puede discutir se
// deja de usar.
export function sugerirCompra({
  hoy,
  stockActual = 0,
  enTransito = 0,
  tasaBase = 0,
  perfil = null,
  sigmaDiaria = 0,
  nivelServicio = 0.95,
  proveedor = {},
  cantidadPorUnidad = 1,
  precioUnitarioCentavos = 0
}) {
  const ventana = ventanaDeCobertura({
    hoy,
    leadTimeDias: proveedor.leadTimeDias,
    diasCiclo: proveedor.diasCiclo,
    diasEntrega: proveedor.diasEntrega
  });

  const demandaVentana = demandaEnVentana(hoy, ventana.diasACubrir, tasaBase, perfil);
  const seguridad = stockDeSeguridad({ sigmaDiaria, dias: ventana.diasACubrir, nivelServicio });
  const objetivo = demandaVentana + seguridad;
  const disponible = stockActual + enTransito;
  const faltante = Math.max(0, objetivo - disponible);

  const porUnidad = Number(cantidadPorUnidad) > 0 ? Number(cantidadPorUnidad) : 1;
  const unidades = faltante > 0 ? Math.ceil(faltante / porUnidad) : 0;
  const cantidadComprada = unidades * porUnidad;

  const stockTrasRecibir = disponible + cantidadComprada;
  const coberturaFinal = diasDeStock(stockTrasRecibir, hoy, tasaBase, perfil);

  return {
    ...ventana,
    demandaVentana,
    seguridad,
    objetivo,
    faltante,
    unidades,
    cantidadComprada,
    // Cuanto de mas entra solo por el tamaño del envase. Es el dato que
    // explica "pedi 300 g de mayonesa y me trajeron un cubo de 5 kg": no es
    // un error del modelo, es que no se vende mas chico.
    excedentePorEnvase: Math.max(0, cantidadComprada - faltante),
    costoTotalCentavos: Math.round(unidades * (Number(precioUnitarioCentavos) || 0)),
    coberturaFinalDias: coberturaFinal
  };
}

// Urgencia con el significado que de verdad importa: no "tengo poco" sino
// "no llego a la proxima entrega".
//
//   urgente — el stock no aguanta hasta que llegue el pedido de hoy. Ya es
//             tarde: o se pide hoy mismo, o hay dias sin ese insumo.
//   pronto  — aguanta hasta este pedido pero no hasta el siguiente. Si no
//             entra en la compra de hoy, falta antes de la proxima.
//   ok      — cubierto hasta la proxima reposicion.
//
// El modelo viejo comparaba contra `diasCiclo` (cada cuanto pido), que es el
// numero equivocado: lo que manda es cuando llega.
export function clasificarUrgencia({ diasDeStockRestantes, diasHastaLlegada, diasACubrir, estadoStock }) {
  if (estadoStock === "critico") return "urgente";
  if (diasDeStockRestantes == null) return estadoStock === "bajo" ? "pronto" : "ok";
  if (diasDeStockRestantes < diasHastaLlegada) return "urgente";
  if (diasDeStockRestantes < diasACubrir) return "pronto";
  return estadoStock === "bajo" ? "pronto" : "ok";
}

// ---------------------------------------------------------------------------
// El modelo VIEJO, tal cual estaba
// ---------------------------------------------------------------------------
// Se queda aca, exportado, por dos razones: documenta exactamente que cambio
// (es la referencia contra la que se mide), y la prueba de backtest necesita
// correr los dos modelos sobre los mismos datos. No lo usa la app.
export function sugerirCompraModeloViejo({
  consumoDiario = 0,
  stockMinimo = 0,
  stockActual = 0,
  diasCiclo = 7,
  cantidadPorUnidad = 1,
  precioUnitarioCentavos = 0
}) {
  const necesidad = consumoDiario > 0 ? consumoDiario * diasCiclo + stockMinimo : stockMinimo * 1.5;
  const faltante = Math.max(0, necesidad - stockActual);
  const porUnidad = Number(cantidadPorUnidad) > 0 ? Number(cantidadPorUnidad) : 1;
  const unidades = faltante > 0 ? Math.ceil(faltante / porUnidad) : 0;
  return {
    objetivo: necesidad,
    faltante,
    unidades,
    cantidadComprada: unidades * porUnidad,
    costoTotalCentavos: Math.round(unidades * (Number(precioUnitarioCentavos) || 0))
  };
}
