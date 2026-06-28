export const SANDWICH_COMBOS = [
  { cantidad: 12, precioCentavos: 3800, nombre: "Combo 12 sandwiches", premiumExtraCentavos: 30 }
];

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

function comboSelection(units, combo) {
  const comboUnits = units.slice(0, combo.cantidad);
  const comboPremiumQuantity = comboUnits.filter((item) => item.isPremium).length;
  if (comboUnits.length < combo.cantidad) return null;
  if (!combo.premiumExtraCentavos && comboPremiumQuantity > combo.maxPremium) return null;

  const comboNormalCentavos = comboUnits.reduce((total, item) => total + item.precioCentavos, 0);
  const totalSandwichCentavos = units.reduce((total, item) => total + item.precioCentavos, 0);
  const premiumExtraCentavos = premiumExtraCharge(comboUnits, combo);
  return {
    comboNormalCentavos,
    extraSandwichCentavos: totalSandwichCentavos - comboNormalCentavos,
    comboPremiumQuantity,
    premiumExtraCentavos
  };
}

export function calculateCartPricing(items) {
  const lines = Array.from(items || []);
  const normalTotalCentavos = lines.reduce((total, item) => total + item.precioCentavos * item.quantity, 0);
  const sandwichLines = lines.filter(isSandwich);
  const sandwichQuantity = sandwichLines.reduce((total, item) => total + item.quantity, 0);
  const sandwichNormalCentavos = sandwichLines.reduce((total, item) => total + item.precioCentavos * item.quantity, 0);
  const nonSandwichCentavos = normalTotalCentavos - sandwichNormalCentavos;
  const sandwichUnits = expandedSandwichUnits(lines);
  const combo = SANDWICH_COMBOS.find((rule) => {
    if (sandwichQuantity < rule.cantidad) return false;
    return comboSelection(sandwichUnits, rule) !== null;
  });

  if (!combo) {
    const blockedCombo = SANDWICH_COMBOS.find((rule) => sandwichQuantity >= rule.cantidad);
    const blockedPremiumQuantity = blockedCombo ? sandwichUnits.filter((item) => item.isPremium).length : 0;
    return {
      normalTotalCentavos,
      totalCentavos: normalTotalCentavos,
      discountCentavos: 0,
      combo: null,
      sandwichQuantity,
      premiumQuantity: blockedPremiumQuantity,
      warning: blockedCombo
        ? blockedCombo.premiumExtraCentavos
          ? ""
          : `${blockedCombo.nombre} admite maximo ${blockedCombo.maxPremium} premium.`
        : ""
    };
  }

  const numCombos = Math.floor(sandwichQuantity / combo.cantidad);
  let totalComboNormalCentavos = 0;
  let totalPremiumExtraCentavos = 0;
  for (let i = 0; i < numCombos; i++) {
    const groupUnits = sandwichUnits.slice(i * combo.cantidad, (i + 1) * combo.cantidad);
    totalComboNormalCentavos += groupUnits.reduce((sum, u) => sum + u.precioCentavos, 0);
    totalPremiumExtraCentavos += premiumExtraCharge(groupUnits, combo);
  }
  const remainingUnits = sandwichUnits.slice(numCombos * combo.cantidad);
  const remainingCentavos = remainingUnits.reduce((sum, u) => sum + u.precioCentavos, 0);
  const comboChargedCentavos = numCombos * combo.precioCentavos + totalPremiumExtraCentavos;
  const totalCentavos = nonSandwichCentavos + comboChargedCentavos + remainingCentavos;
  const comboNombre = numCombos > 1 ? `${numCombos}x ${combo.nombre}` : combo.nombre;
  return {
    normalTotalCentavos,
    totalCentavos,
    discountCentavos: Math.max(0, normalTotalCentavos - totalCentavos),
    combo: { ...combo, nombre: comboNombre, precioCentavos: comboChargedCentavos },
    comboNormalCentavos: totalComboNormalCentavos,
    extraSandwichCentavos: remainingCentavos,
    sandwichQuantity,
    premiumQuantity: sandwichUnits.slice(0, numCombos * combo.cantidad).filter((u) => u.isPremium).length,
    warning: ""
  };
}
