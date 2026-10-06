// Precio de las promos por cantidad — editable desde Gestion > Menu (ver
// combos.js), guardado en configuracion_compartida para que valga en
// cualquier dispositivo. Este modulo guarda el valor VIGENTE en memoria
// (combosConfigActual) y arranca con el default de toda la vida; combos.js
// lo actualiza al arrancar la app y cada vez que se guarda un cambio — asi
// calculateCartPricing/aplicarCombosEnCascada, mas abajo, nunca tienen que
// saber de donde salio el numero.
export const DEFAULT_COMBOS_CONFIG = { docePrecioCentavos: 3400, seisPrecioCentavos: 1900, premiumExtraCentavos: 30 };
let combosConfigActual = DEFAULT_COMBOS_CONFIG;

export function setCombosConfig(valor) {
  combosConfigActual = { ...DEFAULT_COMBOS_CONFIG, ...valor };
}

export function getCombosConfig() {
  return combosConfigActual;
}

function combosVigentes() {
  return [
    { cantidad: 12, precioCentavos: combosConfigActual.docePrecioCentavos, nombre: "Combo 12 sandwiches", premiumExtraCentavos: combosConfigActual.premiumExtraCentavos },
    { cantidad: 6, precioCentavos: combosConfigActual.seisPrecioCentavos, nombre: "Combo 6 sandwiches", premiumExtraCentavos: combosConfigActual.premiumExtraCentavos }
  ];
}

const PREMIUM_SANDWICH_IDS = new Set(["atun-palta-queso", "huevo-jamon", "especial-semanal"]);

function isSandwich(item) {
  return item.categoriaId === "sandwiches" && item.controlaStock;
}

function isPremiumSandwich(item) {
  return isSandwich(item) && (item.sandwichTipo === "premium" || PREMIUM_SANDWICH_IDS.has(item.id));
}

function expandedSandwichUnits(lines) {
  return lines
    .filter(isSandwich)
    .flatMap((item) =>
      Array.from({ length: item.quantity }, () => ({
        precioCentavos: item.precioCentavos,
        isPremium: isPremiumSandwich(item)
      }))
        .map((unit, index) => ({
          ...unit,
          order: item.unitOrders?.[index] ?? Number.MAX_SAFE_INTEGER
        }))
    )
    .sort((a, b) => a.order - b.order);
}

function premiumExtraCharge(comboUnits, combo) {
  if (!combo.premiumExtraCentavos) return 0;
  const premiumUnits = comboUnits.filter((item) => item.isPremium).length;
  return premiumUnits * combo.premiumExtraCentavos;
}

// Aplica los combos de mayor a menor cantidad (docena antes que el de 6),
// tantas veces como entren, y recien cuando ya no entra otro del mismo
// tamano pasa al combo mas chico con lo que sobro. Ej: 18 sandwiches -> 1
// docena (12) + 1 combo de 6 (6) + 0 sueltos. 17 sandwiches -> 1 docena (12)
// + 5 sueltos a precio normal (no alcanza para un segundo combo de 6). Los
// sandwiches se toman en el orden en que se agregaron al carrito
// (unitOrders), no por precio.
function aplicarCombosEnCascada(sandwichUnits, sandwichQuantity) {
  const combosOrdenados = combosVigentes().sort((a, b) => b.cantidad - a.cantidad);
  const aplicados = [];
  let cursor = 0;
  let restante = sandwichQuantity;

  for (const combo of combosOrdenados) {
    const veces = Math.floor(restante / combo.cantidad);
    if (veces <= 0) continue;
    let chargedCentavos = 0;
    let normalCentavos = 0;
    for (let i = 0; i < veces; i++) {
      const groupUnits = sandwichUnits.slice(cursor, cursor + combo.cantidad);
      cursor += combo.cantidad;
      normalCentavos += groupUnits.reduce((sum, u) => sum + u.precioCentavos, 0);
      chargedCentavos += combo.precioCentavos + premiumExtraCharge(groupUnits, combo);
    }
    aplicados.push({ combo, veces, chargedCentavos, normalCentavos });
    restante -= veces * combo.cantidad;
  }

  return { aplicados, cursor, remainingUnits: sandwichUnits.slice(cursor) };
}

export function calculateCartPricing(items) {
  const lines = Array.from(items || []);
  const normalTotalCentavos = lines.reduce((total, item) => total + item.precioCentavos * item.quantity, 0);
  const sandwichLines = lines.filter(isSandwich);
  const sandwichQuantity = sandwichLines.reduce((total, item) => total + item.quantity, 0);
  const sandwichNormalCentavos = sandwichLines.reduce((total, item) => total + item.precioCentavos * item.quantity, 0);
  const nonSandwichCentavos = normalTotalCentavos - sandwichNormalCentavos;
  const sandwichUnits = expandedSandwichUnits(lines);

  const { aplicados, cursor, remainingUnits } = aplicarCombosEnCascada(sandwichUnits, sandwichQuantity);

  if (aplicados.length === 0) {
    return {
      normalTotalCentavos,
      totalCentavos: normalTotalCentavos,
      discountCentavos: 0,
      combo: null,
      sandwichQuantity,
      premiumQuantity: 0,
      warning: ""
    };
  }

  const remainingCentavos = remainingUnits.reduce((sum, u) => sum + u.precioCentavos, 0);
  const comboChargedTotal = aplicados.reduce((sum, a) => sum + a.chargedCentavos, 0);
  const comboNormalTotal = aplicados.reduce((sum, a) => sum + a.normalCentavos, 0);
  const totalCentavos = nonSandwichCentavos + comboChargedTotal + remainingCentavos;
  // Enuncia todas las promos aplicadas juntas, ej: "Combo 12 sandwiches + Combo 6 sandwiches".
  const nombre = aplicados
    .map((a) => (a.veces > 1 ? `${a.veces}x ${a.combo.nombre}` : a.combo.nombre))
    .join(" + ");

  return {
    normalTotalCentavos,
    totalCentavos,
    discountCentavos: Math.max(0, normalTotalCentavos - totalCentavos),
    combo: { nombre, precioCentavos: comboChargedTotal, cantidad: cursor },
    comboNormalCentavos: comboNormalTotal,
    extraSandwichCentavos: remainingCentavos,
    sandwichQuantity,
    premiumQuantity: sandwichUnits.slice(0, cursor).filter((u) => u.isPremium).length,
    warning: ""
  };
}
