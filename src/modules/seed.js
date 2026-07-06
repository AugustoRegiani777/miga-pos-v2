export const DB_NAME = "miga-pos-local";
export const DB_VERSION = 10;

export const STORE_NAMES = [
  "categorias",
  "productos",
  "produccion_diaria",
  "ventas",
  "detalle_venta",
  "movimientos_stock",
  "configuracion",
  "cierres_diarios",
  "insumos",
  "recetas",
  "movimientos_insumos",
  "historial_calibraciones",
  "historial_recetas",
  "proveedores",
  "proveedor_insumos"
];

// Versión del seed de insumos — incrementar cuando cambien insumos o stockMinimo/stockCritico
// para forzar actualización en IDB aunque los insumos ya existan.
// Basado en análisis de 18 días de ventas reales (mayo-junio 2026): ~113 sándwiches/día promedio.
// stockMinimo = 3 días de consumo | stockCritico = 1.5 días de consumo
export const INSUMOS_SEED_VERSION = 6;

export const initialInsumos = [
  // Pan — 1 rebanada = 1 longa. Paquete de 12 lonchas. ~57 rebanadas/día → ~4.75 paquetes/día
  { id: "miga",             nombre: "Miga (pan)",         unidad: "rebanada", unidadCompra: "paquete", factorConversion: 12,   stockActual: 0, stockMinimo: 170,  stockCritico: 90,   esEstimado: false, activo: true },
  // (38+9+8.7+9.4+13.1+9.4+0.3) × 25g = ~2200g/día
  { id: "queso-gouda",      nombre: "Queso gouda",         unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 6600, stockCritico: 3300, esEstimado: false, activo: true },
  // (38+11.5) × 20g = ~990g/día
  { id: "jamon-york",       nombre: "Jamon york",          unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 3000, stockCritico: 1500, esEstimado: false, activo: true },
  // 13.1 × 20g = ~262g/día
  { id: "jamon-serrano",    nombre: "Jamon serrano",       unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 800,  stockCritico: 400,  esEstimado: false, activo: true },
  // 9 × 33g = ~297g/día
  { id: "pasta-aceituna",   nombre: "Pasta de aceituna",   unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 900,  stockCritico: 450,  esEstimado: false, activo: true },
  // 8.7 × 33g = ~287g/día
  { id: "pimientos-asados", nombre: "Pimientos asados",    unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 850,  stockCritico: 450,  esEstimado: false, activo: true },
  // 9.4 × 23g = ~216g/día
  { id: "pesto",            nombre: "Pesto",               unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 650,  stockCritico: 325,  esEstimado: false, activo: true },
  // 9.4 × 30g = ~282g/día
  { id: "tomate",           nombre: "Tomate",              unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 850,  stockCritico: 425,  esEstimado: true,  activo: true },
  // 9.4 × 27g = ~254g/día
  { id: "palta",            nombre: "Palta",               unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 750,  stockCritico: 400,  esEstimado: false, activo: true },
  // 9.4 × 33g = ~310g/día
  { id: "atun",             nombre: "Atun",                unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 950,  stockCritico: 475,  esEstimado: false, activo: true },
  // 8.7 × 20g = ~174g/día
  { id: "queso-crema",      nombre: "Queso crema",         unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 525,  stockCritico: 275,  esEstimado: false, activo: true },
  // 13.1 × 10g = ~131g/día
  { id: "rucula",           nombre: "Rucula",              unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 400,  stockCritico: 200,  esEstimado: false, activo: true },
  // 4.4 × 27g = ~119g/día
  { id: "berenjena",        nombre: "Berenjena asada",     unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 350,  stockCritico: 175,  esEstimado: false, activo: true },
  // 4.4 × 20g = ~88g/día
  { id: "queso-brie",       nombre: "Queso brie",          unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 275,  stockCritico: 150,  esEstimado: false, activo: true },
  // ~104 sand × 5g = ~520g/día (mayonesa reemplaza mezcla)
  { id: "mayonesa",         nombre: "Mayonesa",            unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 1550, stockCritico: 800,  esEstimado: true,  activo: true },
  // (11.5+0.3) × 1 = ~12/día — paquete de 24 unidades
  { id: "huevo",            nombre: "Huevo",               unidad: "unidad",   unidadCompra: "paquete", factorConversion: 24,   stockActual: 0, stockMinimo: 36,   stockCritico: 18,   esEstimado: false, activo: true },
  // 10g por café base — bolsa de 1kg — ~25 cafés/día = ~250g/día estimado
  { id: "cafe",             nombre: "Cafe",                unidad: "g",        unidadCompra: "bolsa",   factorConversion: 1000, stockActual: 0, stockMinimo: 800,  stockCritico: 400,  esEstimado: true,  activo: true },
  // Leche por ml, compra por L (1000ml) — leche normal ~15 bebidas×150ml=2250ml/día estimado
  { id: "leche-normal",     nombre: "Leche entera",        unidad: "ml",       unidadCompra: "L",       factorConversion: 1000, stockActual: 0, stockMinimo: 6750, stockCritico: 3375, esEstimado: true,  activo: true },
  // Leche avena ~5 bebidas/día = 750ml/día estimado
  { id: "leche-avena",      nombre: "Leche de avena",      unidad: "ml",       unidadCompra: "L",       factorConversion: 1000, stockActual: 0, stockMinimo: 2250, stockCritico: 1125, esEstimado: true,  activo: true },
  // Leche sin lactosa ~5 bebidas/día = 750ml/día estimado
  { id: "leche-sin-lactosa",nombre: "Leche sin lactosa",   unidad: "ml",       unidadCompra: "L",       factorConversion: 1000, stockActual: 0, stockMinimo: 2250, stockCritico: 1125, esEstimado: true,  activo: true },
  // Dulce de leche — mini-croissant-ddl ~15/día × 20g = 300g/día estimado
  { id: "dulce-de-leche",   nombre: "Dulce de leche",      unidad: "g",        unidadCompra: "kg",      factorConversion: 1000, stockActual: 0, stockMinimo: 900,  stockCritico: 450,  esEstimado: true,  activo: true }
];

export const initialRecetas = [
  // Jamon y queso
  { id: "jamon-queso:miga",         productoId: "jamon-queso",         insumoId: "miga",         cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "jamon-queso:jamon-york",   productoId: "jamon-queso",         insumoId: "jamon-york",   cantidadPorUnidad: 20,   esEstimado: false },
  { id: "jamon-queso:queso-gouda",  productoId: "jamon-queso",         insumoId: "queso-gouda",  cantidadPorUnidad: 25,   esEstimado: false },
  { id: "jamon-queso:mayonesa",     productoId: "jamon-queso",         insumoId: "mayonesa",     cantidadPorUnidad: 5,    esEstimado: true  },
  // Pasta Oliva y queso
  { id: "pasta-oliva-queso:miga",           productoId: "pasta-oliva-queso", insumoId: "miga",           cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "pasta-oliva-queso:pasta-aceituna", productoId: "pasta-oliva-queso", insumoId: "pasta-aceituna", cantidadPorUnidad: 33,   esEstimado: false },
  { id: "pasta-oliva-queso:queso-gouda",    productoId: "pasta-oliva-queso", insumoId: "queso-gouda",    cantidadPorUnidad: 25,   esEstimado: false },
  { id: "pasta-oliva-queso:mayonesa",       productoId: "pasta-oliva-queso", insumoId: "mayonesa",       cantidadPorUnidad: 5,    esEstimado: true  },
  // Pimiento asado, gouda, philp
  { id: "pimiento-gouda-philp:miga",              productoId: "pimiento-gouda-philp", insumoId: "miga",             cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "pimiento-gouda-philp:pimientos-asados",  productoId: "pimiento-gouda-philp", insumoId: "pimientos-asados", cantidadPorUnidad: 33,   esEstimado: false },
  { id: "pimiento-gouda-philp:queso-crema",       productoId: "pimiento-gouda-philp", insumoId: "queso-crema",      cantidadPorUnidad: 20,   esEstimado: false },
  { id: "pimiento-gouda-philp:queso-gouda",       productoId: "pimiento-gouda-philp", insumoId: "queso-gouda",      cantidadPorUnidad: 25,   esEstimado: false },
  { id: "pimiento-gouda-philp:mayonesa",          productoId: "pimiento-gouda-philp", insumoId: "mayonesa",         cantidadPorUnidad: 5,    esEstimado: true  },
  // Pesto, tomate y queso
  { id: "pesto-tomate-queso:miga",        productoId: "pesto-tomate-queso", insumoId: "miga",        cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "pesto-tomate-queso:pesto",       productoId: "pesto-tomate-queso", insumoId: "pesto",       cantidadPorUnidad: 23,   esEstimado: false },
  { id: "pesto-tomate-queso:tomate",      productoId: "pesto-tomate-queso", insumoId: "tomate",      cantidadPorUnidad: 30,   esEstimado: true  },
  { id: "pesto-tomate-queso:queso-gouda", productoId: "pesto-tomate-queso", insumoId: "queso-gouda", cantidadPorUnidad: 25,   esEstimado: false },
  { id: "pesto-tomate-queso:mayonesa",    productoId: "pesto-tomate-queso", insumoId: "mayonesa",    cantidadPorUnidad: 5,    esEstimado: true  },
  // Berenjena y queso brie
  { id: "berenjena-brie:miga",       productoId: "berenjena-brie", insumoId: "miga",       cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "berenjena-brie:berenjena",  productoId: "berenjena-brie", insumoId: "berenjena",  cantidadPorUnidad: 27,   esEstimado: false },
  { id: "berenjena-brie:queso-brie", productoId: "berenjena-brie", insumoId: "queso-brie", cantidadPorUnidad: 20,   esEstimado: false },
  { id: "berenjena-brie:mayonesa",   productoId: "berenjena-brie", insumoId: "mayonesa",   cantidadPorUnidad: 5,    esEstimado: true  },
  // Jamon serrano y rucula
  { id: "jamon-serrano-rucula:miga",          productoId: "jamon-serrano-rucula", insumoId: "miga",          cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "jamon-serrano-rucula:jamon-serrano", productoId: "jamon-serrano-rucula", insumoId: "jamon-serrano", cantidadPorUnidad: 20,   esEstimado: false },
  { id: "jamon-serrano-rucula:rucula",        productoId: "jamon-serrano-rucula", insumoId: "rucula",        cantidadPorUnidad: 10,   esEstimado: false },
  { id: "jamon-serrano-rucula:queso-gouda",   productoId: "jamon-serrano-rucula", insumoId: "queso-gouda",   cantidadPorUnidad: 25,   esEstimado: false },
  { id: "jamon-serrano-rucula:mayonesa",      productoId: "jamon-serrano-rucula", insumoId: "mayonesa",      cantidadPorUnidad: 5,    esEstimado: true  },
  // Atun, palta y queso
  { id: "atun-palta-queso:miga",        productoId: "atun-palta-queso", insumoId: "miga",        cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "atun-palta-queso:atun",        productoId: "atun-palta-queso", insumoId: "atun",        cantidadPorUnidad: 33,   esEstimado: false },
  { id: "atun-palta-queso:palta",       productoId: "atun-palta-queso", insumoId: "palta",       cantidadPorUnidad: 27,   esEstimado: false },
  { id: "atun-palta-queso:queso-gouda", productoId: "atun-palta-queso", insumoId: "queso-gouda", cantidadPorUnidad: 25,   esEstimado: false },
  { id: "atun-palta-queso:mayonesa",    productoId: "atun-palta-queso", insumoId: "mayonesa",    cantidadPorUnidad: 5,    esEstimado: true  },
  // Huevo y Jamon
  { id: "huevo-jamon:miga",       productoId: "huevo-jamon", insumoId: "miga",       cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "huevo-jamon:huevo",      productoId: "huevo-jamon", insumoId: "huevo",      cantidadPorUnidad: 1,    esEstimado: false },
  { id: "huevo-jamon:jamon-york", productoId: "huevo-jamon", insumoId: "jamon-york", cantidadPorUnidad: 20,   esEstimado: false },
  { id: "huevo-jamon:mayonesa",   productoId: "huevo-jamon", insumoId: "mayonesa",   cantidadPorUnidad: 5,    esEstimado: true  },
  // Huevo y Queso
  { id: "huevo-queso:miga",        productoId: "huevo-queso", insumoId: "miga",        cantidadPorUnidad: 0.5,  esEstimado: false, recetaFija: true },
  { id: "huevo-queso:huevo",       productoId: "huevo-queso", insumoId: "huevo",       cantidadPorUnidad: 1,    esEstimado: false },
  { id: "huevo-queso:queso-gouda", productoId: "huevo-queso", insumoId: "queso-gouda", cantidadPorUnidad: 25,   esEstimado: false },
  { id: "huevo-queso:mayonesa",    productoId: "huevo-queso", insumoId: "mayonesa",    cantidadPorUnidad: 5,    esEstimado: true  },
  // Mini croissant con dulce de leche
  { id: "mini-croissant-ddl:dulce-de-leche", productoId: "mini-croissant-ddl", insumoId: "dulce-de-leche", cantidadPorUnidad: 20, esEstimado: true },
  // Café — 10g por espresso (confirmado). Las cantidades de leche son estimadas (~).
  { id: "expresso-30ml:cafe",          productoId: "expresso-30ml",     insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "cortado:cafe",                productoId: "cortado",           insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "cortado:leche-normal",        productoId: "cortado",           insumoId: "leche-normal", cantidadPorUnidad: 30,  esEstimado: true  },
  { id: "latte:cafe",                  productoId: "latte",             insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "latte:leche-normal",          productoId: "latte",             insumoId: "leche-normal", cantidadPorUnidad: 200, esEstimado: true  },
  { id: "cafe-con-leche:cafe",         productoId: "cafe-con-leche",    insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "cafe-con-leche:leche-normal", productoId: "cafe-con-leche",    insumoId: "leche-normal", cantidadPorUnidad: 200, esEstimado: true  },
  { id: "promo-cafe-con-leche:cafe",   productoId: "promo-cafe-con-leche", insumoId: "cafe",      cantidadPorUnidad: 10,  esEstimado: false },
  { id: "promo-cafe-con-leche:leche-normal", productoId: "promo-cafe-con-leche", insumoId: "leche-normal", cantidadPorUnidad: 200, esEstimado: true },
  { id: "capuccino:cafe",              productoId: "capuccino",         insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "capuccino:leche-normal",      productoId: "capuccino",         insumoId: "leche-normal", cantidadPorUnidad: 150, esEstimado: true  },
  { id: "americano:cafe",              productoId: "americano",         insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "flat-white:cafe",             productoId: "flat-white",        insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "flat-white:leche-normal",     productoId: "flat-white",        insumoId: "leche-normal", cantidadPorUnidad: 150, esEstimado: true  },
  { id: "ice-latte:cafe",              productoId: "ice-latte",         insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "ice-latte:leche-normal",      productoId: "ice-latte",         insumoId: "leche-normal", cantidadPorUnidad: 200, esEstimado: true  },
  { id: "ice-caramel:cafe",            productoId: "ice-caramel",       insumoId: "cafe",         cantidadPorUnidad: 10,  esEstimado: false },
  { id: "ice-caramel:leche-normal",    productoId: "ice-caramel",       insumoId: "leche-normal", cantidadPorUnidad: 200, esEstimado: true  }
];

export const initialCategories = [
  { id: "sandwiches", nombre: "Sandwiches", orden: 1 },
  { id: "bolleria", nombre: "Bolleria", orden: 2 },
  { id: "cafe", nombre: "Cafe", orden: 3 },
  { id: "bebidas", nombre: "Bebidas", orden: 4 }
];

export const initialProducts = [
  {
    id: "jamon-queso",
    categoriaId: "sandwiches",
    nombre: "Jamon y queso",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 15,
    controlaStock: true,
    orden: 1,
    activo: true
  },
  {
    id: "pasta-oliva-queso",
    categoriaId: "sandwiches",
    nombre: "Pasta Oliva y queso",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 15,
    controlaStock: true,
    orden: 2,
    activo: true
  },
  {
    id: "pimiento-gouda-philp",
    categoriaId: "sandwiches",
    nombre: "Pimiento asado, gouda, philp",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 15,
    controlaStock: true,
    orden: 3,
    activo: true
  },
  {
    id: "pesto-tomate-queso",
    categoriaId: "sandwiches",
    nombre: "Pesto, tomate y queso",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 15,
    controlaStock: true,
    orden: 4,
    activo: true
  },
  {
    id: "berenjena-brie",
    categoriaId: "sandwiches",
    nombre: "Berenjena y queso brie",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 15,
    controlaStock: true,
    orden: 5,
    activo: true
  },
  {
    id: "jamon-serrano-rucula",
    categoriaId: "sandwiches",
    nombre: "Jamon serrano y rucula",
    precioCentavos: 350,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 10,
    controlaStock: true,
    orden: 6,
    activo: true
  },
  {
    id: "atun-palta-queso",
    categoriaId: "sandwiches",
    nombre: "Atun, palta y queso",
    precioCentavos: 380,
    sandwichTipo: "premium",
    stockActual: 0,
    umbralBajo: 10,
    controlaStock: true,
    orden: 7,
    activo: true
  },
  {
    id: "huevo-jamon",
    categoriaId: "sandwiches",
    nombre: "Huevo y Jamon",
    precioCentavos: 380,
    sandwichTipo: "premium",
    stockActual: 0,
    umbralBajo: 10,
    controlaStock: true,
    orden: 8,
    activo: true
  },
  {
    id: "huevo-queso",
    categoriaId: "sandwiches",
    nombre: "Huevo y Queso",
    precioCentavos: 380,
    sandwichTipo: "premium",
    stockActual: 0,
    umbralBajo: 10,
    controlaStock: true,
    orden: 9,
    activo: true
  },
  {
    id: "especial-semanal",
    categoriaId: "sandwiches",
    nombre: "Especial semanal",
    precioCentavos: 380,
    sandwichTipo: "premium",
    stockActual: 0,
    umbralBajo: 10,
    controlaStock: true,
    orden: 10,
    activo: true
  },
  {
    id: "promo-bebida",
    categoriaId: "sandwiches",
    nombre: "Promo bebiba",
    precioCentavos: 80,
    sandwichTipo: "basico",
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 11,
    activo: true
  },
  {
    id: "croissant",
    categoriaId: "bolleria",
    nombre: "Croissant",
    precioCentavos: 150,
    stockActual: 0,
    umbralBajo: 4,
    controlaStock: true,
    orden: 1,
    activo: true
  },
  {
    id: "mini-croissant",
    categoriaId: "bolleria",
    nombre: "Mini croissant",
    precioCentavos: 100,
    stockActual: 0,
    umbralBajo: 4,
    controlaStock: true,
    orden: 2,
    activo: true
  },
  {
    id: "mini-croissant-ddl",
    categoriaId: "bolleria",
    nombre: "Mini croissant ddl",
    precioCentavos: 120,
    stockActual: 0,
    umbralBajo: 4,
    controlaStock: true,
    orden: 3,
    activo: true
  },
  {
    id: "pain-au-chocolat",
    categoriaId: "bolleria",
    nombre: "Pain au chocolat",
    precioCentavos: 150,
    stockActual: 0,
    umbralBajo: 4,
    controlaStock: true,
    orden: 4,
    activo: true
  },
  {
    id: "chipa",
    categoriaId: "bolleria",
    nombre: "Chipa",
    precioCentavos: 100,
    stockActual: 0,
    umbralBajo: 4,
    controlaStock: true,
    orden: 5,
    activo: true
  },
  {
    id: "alfajor-havana",
    categoriaId: "bolleria",
    nombre: "Alfajor Havana",
    precioCentavos: 300,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 6,
    activo: true
  },
  {
    id: "expresso-30ml",
    categoriaId: "cafe",
    nombre: "Expresso 30ml",
    precioCentavos: 150,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 1,
    activo: true
  },
  {
    id: "cortado",
    categoriaId: "cafe",
    nombre: "Cortado",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 2,
    activo: true
  },
  {
    id: "latte",
    categoriaId: "cafe",
    nombre: "Latte",
    precioCentavos: 280,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 3,
    activo: true
  },
  {
    id: "cafe-con-leche",
    categoriaId: "cafe",
    nombre: "Cafe con leche",
    precioCentavos: 280,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 4,
    activo: true
  },
  {
    id: "promo-cafe-con-leche",
    categoriaId: "sandwiches",
    nombre: "Promo Cafe con leche",
    precioCentavos: 240,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 12,
    activo: true
  },
  {
    id: "capuccino",
    categoriaId: "cafe",
    nombre: "Capuccino",
    precioCentavos: 280,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 6,
    activo: true
  },
  {
    id: "americano",
    categoriaId: "cafe",
    nombre: "Americano",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 7,
    activo: true
  },
  {
    id: "flat-white",
    categoriaId: "cafe",
    nombre: "Flat white",
    precioCentavos: 300,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 8,
    activo: true
  },
  {
    id: "ice-latte",
    categoriaId: "cafe",
    nombre: "Ice Latte",
    precioCentavos: 300,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 9,
    activo: true
  },
  {
    id: "ice-caramel",
    categoriaId: "cafe",
    nombre: "Ice Caramel",
    precioCentavos: 320,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 10,
    activo: true
  },
  {
    id: "cerveza",
    categoriaId: "bebidas",
    nombre: "Cerveza",
    precioCentavos: 250,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 1,
    activo: true
  },
  {
    id: "coca-cola",
    categoriaId: "bebidas",
    nombre: "Coca cola",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 2,
    activo: true
  },
  {
    id: "sprite",
    categoriaId: "bebidas",
    nombre: "Sprite",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 3,
    activo: true
  },
  {
    id: "nestea",
    categoriaId: "bebidas",
    nombre: "Nestea",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 4,
    activo: true
  },
  {
    id: "aquiaros",
    categoriaId: "bebidas",
    nombre: "Aquiarios",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 5,
    activo: true
  },
  {
    id: "jugo",
    categoriaId: "bebidas",
    nombre: "Jugo",
    precioCentavos: 200,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 6,
    activo: true
  },
  {
    id: "agua",
    categoriaId: "bebidas",
    nombre: "Agua",
    precioCentavos: 150,
    stockActual: 0,
    umbralBajo: 0,
    controlaStock: false,
    orden: 7,
    activo: true
  }
];

export const PROVEEDORES_SEED_VERSION = 5;

export const initialProveedores = [
  { id: "mercadona",         nombre: "Mercadona",               tel: "800 500 220",   email: "",                           notas: "Pedido online. Entrega mart/mier/vier aprox. Pago tarjeta domiciliada.",              diasCiclo: 3,  activo: true },
  { id: "tropicalia",        nombre: "Tropicalia",              tel: "963346917",     email: "",                           notas: "Pan de miga congelado y reposteria argentina. Agente Gustavo: 654615630. Domiciliacion.", diasCiclo: 7,  activo: true },
  { id: "reyunos",           nombre: "Los Reyunos",             tel: "916852999",     email: "comercial@losreyunos.es",    notas: "Pan de miga. Mas barato que Tropicalia. Pago transferencia.",                        diasCiclo: 14, activo: true },
  { id: "jasa",              nombre: "JASA Alimentacion",       tel: "963961386",     email: "",                           notas: "Jamon y congelados. Agente Sara Bonilla. Giro 7 dias. jasaalimentacion.com",          diasCiclo: 7,  activo: true },
  { id: "kaffetto",          nombre: "Kaffetto Coffee Roasters",tel: "611876699",     email: "contacto@kaffetto.es",       notas: "Cafe specialty. Pago transferencia.",                                                diasCiclo: 30, activo: true },
  { id: "makro",             nombre: "Makro (Albuixech)",       tel: "961400616",     email: "",                           notas: "Lacteos, siropes, varios. Gestora: Cristina Vano. Pago efectivo a entrega.",          diasCiclo: 14, activo: true },
  { id: "delicias-vegetales",nombre: "Delicias Vegetales",      tel: "",              email: "unodemigavalencia@gmail.com",notas: "Verdura ecologica. Orihuela. Pago tarjeta. Envio gratis.",                           diasCiclo: 7,  activo: true },
  { id: "pampa",             nombre: "Pampa Drugstore",         tel: "666085041",     email: "",                           notas: "Reposteria argentina. Barcelona. Mas caro que Tropicalia para alfajores. Pago tarjeta.", diasCiclo: 30, activo: true }
];

// cantidadPorUnidad = cuanto insumo (en su unidad base) hay por unidadCompra
// precioUnitarioCentavos = precio de 1 unidadCompra en centimos de euro
export const initialProveedorInsumos = [
  // Mercadona
  { id: "mercadona:huevo",        proveedorId: "mercadona",          insumoId: "huevo",           nombreProducto: "Huevos M pack 12",                               unidadCompra: "pack",            cantidadPorUnidad: 12,   precioUnitarioCentavos: 560,  activo: true },
  { id: "mercadona:tomate",       proveedorId: "mercadona",          insumoId: "tomate",          nombreProducto: "Tomate pera (~400g/ud)",                         unidadCompra: "unidad",          cantidadPorUnidad: 400,  precioUnitarioCentavos: 215,  activo: true },
  { id: "mercadona:palta",        proveedorId: "mercadona",          insumoId: "palta",           nombreProducto: "Aguacate (~200g/ud)",                            unidadCompra: "unidad",          cantidadPorUnidad: 200,  precioUnitarioCentavos: 315,  activo: true },
  { id: "mercadona:queso-crema",  proveedorId: "mercadona",          insumoId: "queso-crema",     nombreProducto: "Queso untar Philadelphia light 250g",            unidadCompra: "tarro",           cantidadPorUnidad: 250,  precioUnitarioCentavos: 290,  activo: true },
  // Tropicalia
  { id: "tropicalia:miga",        proveedorId: "tropicalia",         insumoId: "miga",            nombreProducto: "Pan de Miga 12reb 9mm 28x28 congelado 1.43kg",  unidadCompra: "paquete",         cantidadPorUnidad: 12,   precioUnitarioCentavos: 1250, activo: true },
  { id: "tropicalia:ddl",         proveedorId: "tropicalia",         insumoId: "dulce-de-leche",  nombreProducto: "Dulce de leche Mardel Clasico 1kg",              unidadCompra: "tarro",           cantidadPorUnidad: 1000, precioUnitarioCentavos: 595,  activo: true },
  // Los Reyunos
  { id: "reyunos:miga",           proveedorId: "reyunos",            insumoId: "miga",            nombreProducto: "MIGA 09 MM (P) paquete 12 lonchas",             unidadCompra: "paquete",         cantidadPorUnidad: 12,   precioUnitarioCentavos: 948,  activo: true },
  // JASA
  { id: "jasa:jamon-serrano",      proveedorId: "jasa",               insumoId: "jamon-serrano",   nombreProducto: "Centro Jamon Bodega (serrano curado, ≤4°C)",     unidadCompra: "kg",              cantidadPorUnidad: 1000, precioUnitarioCentavos: 1180, activo: true },
  { id: "jasa:jamon-york",        proveedorId: "jasa",               insumoId: "jamon-york",      nombreProducto: "Paleta Barra Sandwich 11x11 Comas (≤4°C)",       unidadCompra: "kg",              cantidadPorUnidad: 1000, precioUnitarioCentavos: 510,  activo: true },
  { id: "jasa:queso-gouda",       proveedorId: "jasa",               insumoId: "queso-gouda",     nombreProducto: "Queso Barra Gouda",                              unidadCompra: "kg",              cantidadPorUnidad: 1000, precioUnitarioCentavos: 520,  activo: true },
  { id: "jasa:queso-brie",        proveedorId: "jasa",               insumoId: "queso-brie",      nombreProducto: "Queso Barra Brie 1,3 kg",                        unidadCompra: "kg",              cantidadPorUnidad: 1000, precioUnitarioCentavos: 1051, activo: true },
  { id: "jasa:atun",              proveedorId: "jasa",               insumoId: "atun",            nombreProducto: "Atun Aceite Trozo Buen Apetito C/12-BL 950g n.e",unidadCompra: "bolsa",           cantidadPorUnidad: 950,  precioUnitarioCentavos: 580,  activo: true },
  { id: "jasa:aceitunas",         proveedorId: "jasa",               insumoId: "pasta-aceituna",  nombreProducto: "Aceituna Verde Rodaja Lortet C/6-LT 1,56kg",     unidadCompra: "lata",            cantidadPorUnidad: 1560, precioUnitarioCentavos: 745,  activo: true },
  { id: "jasa:salmon",            proveedorId: "jasa",               insumoId: null,              nombreProducto: "Salmon Ahumado Recorte Cong. C/10-BL 1kg",       unidadCompra: "bolsa",           cantidadPorUnidad: 1000, precioUnitarioCentavos: 1530, activo: true },
  { id: "jasa:queso-mezcla",      proveedorId: "jasa",               insumoId: null,              nombreProducto: "Queso Mezcla Semi Cuña Cortada 500g Albeniz",    unidadCompra: "cuña",            cantidadPorUnidad: 500,  precioUnitarioCentavos: 720,  activo: true },
  { id: "jasa:palta",             proveedorId: "jasa",               insumoId: "palta",           nombreProducto: "Aguacate Dado 1.5x1.5 congelado 1kg",           unidadCompra: "bolsa",           cantidadPorUnidad: 1000, precioUnitarioCentavos: 495,  activo: true },
  // Kaffetto
  { id: "kaffetto:guatemala",     proveedorId: "kaffetto",           insumoId: "cafe",            nombreProducto: "Cafe Guatemala",                                 unidadCompra: "bolsa 1kg",       cantidadPorUnidad: 1000, precioUnitarioCentavos: 2190, activo: true },
  { id: "kaffetto:decaf",         proveedorId: "kaffetto",           insumoId: "cafe",            nombreProducto: "Cafe Mexico Decaf",                              unidadCompra: "bolsa 1kg",       cantidadPorUnidad: 1000, precioUnitarioCentavos: 2390, activo: true },
  // Makro
  { id: "makro:leche-normal",     proveedorId: "makro",              insumoId: "leche-normal",    nombreProducto: "Leche Gran Creme BT 1.5L (caja 6 bot = 9L)",    unidadCompra: "caja",            cantidadPorUnidad: 9000, precioUnitarioCentavos: 935,  activo: true },
  { id: "makro:leche-avena",      proveedorId: "makro",              insumoId: "leche-avena",     nombreProducto: "Bebida Avena Bio 1L",                            unidadCompra: "brik",            cantidadPorUnidad: 1000, precioUnitarioCentavos: 141,  activo: true },
  { id: "makro:rucula",           proveedorId: "makro",              insumoId: "rucula",          nombreProducto: "Rucula Salvatica 250g",                          unidadCompra: "bolsa",           cantidadPorUnidad: 250,  precioUnitarioCentavos: 297,  activo: true },
  { id: "makro:berenjena",        proveedorId: "makro",              insumoId: "berenjena",       nombreProducto: "Berenjena Negra caja 6kg",                       unidadCompra: "caja",            cantidadPorUnidad: 6000, precioUnitarioCentavos: 780,  activo: true },
  // Delicias Vegetales
  { id: "delicias:berenjena",     proveedorId: "delicias-vegetales", insumoId: "berenjena",       nombreProducto: "Berenjena bolsa 1kg",                            unidadCompra: "bolsa",           cantidadPorUnidad: 1000, precioUnitarioCentavos: 540,  activo: true },
  { id: "delicias:pimientos",     proveedorId: "delicias-vegetales", insumoId: "pimientos-asados",nombreProducto: "Pimiento asado entero bolsa 4kg",                unidadCompra: "bolsa",           cantidadPorUnidad: 4000, precioUnitarioCentavos: 2047, activo: true },
  // Mercadona — productos adicionales
  { id: "mercadona:berenjena",    proveedorId: "mercadona",          insumoId: "berenjena",       nombreProducto: "Berenjena rayada",                               unidadCompra: "kg",              cantidadPorUnidad: 1000, precioUnitarioCentavos: 230,  activo: true },
  // Tropicalia — reposteria argentina (para reventa, insumoId null)
  { id: "tropicalia:alfajor-choc",proveedorId: "tropicalia",         insumoId: null,              nombreProducto: "Alfajor Havanna Chocolate caja x12 (660g)",      unidadCompra: "caja",            cantidadPorUnidad: 12,   precioUnitarioCentavos: 1585, activo: true },
  { id: "tropicalia:alfajor-mer", proveedorId: "tropicalia",         insumoId: null,              nombreProducto: "Alfajor Havanna Merengue caja x6 (282g)",        unidadCompra: "caja",            cantidadPorUnidad: 6,    precioUnitarioCentavos: 875,  activo: true },
  { id: "tropicalia:alfajor-mix", proveedorId: "tropicalia",         insumoId: null,              nombreProducto: "Alfajor Havanna Mixto caja x12 (612g)",          unidadCompra: "caja",            cantidadPorUnidad: 12,   precioUnitarioCentavos: 1585, activo: true },
  { id: "tropicalia:chocolinas",  proveedorId: "tropicalia",         insumoId: null,              nombreProducto: "Galletas Bagley Chocolinas caja x12 (170g/ud)",  unidadCompra: "caja",            cantidadPorUnidad: 12,   precioUnitarioCentavos: 1295, activo: true },
  { id: "tropicalia:almidon",     proveedorId: "tropicalia",         insumoId: null,              nombreProducto: "Almidon de yuca Codipsa dulce 1kg",              unidadCompra: "bolsa",           cantidadPorUnidad: 1000, precioUnitarioCentavos: 285,  activo: true },
  // Pampa Drugstore — mismos alfajores Havanna, mas caro que Tropicalia
  { id: "pampa:alfajor-choc",     proveedorId: "pampa",              insumoId: null,              nombreProducto: "Alfajor Havanna Chocolate caja x12",             unidadCompra: "caja",            cantidadPorUnidad: 12,   precioUnitarioCentavos: 1905, activo: true },
  // Makro — productos adicionales
  { id: "makro:sirope-caramelo",  proveedorId: "makro",              insumoId: null,              nombreProducto: "Sirope MC 1kg Caramelo",                         unidadCompra: "botella",         cantidadPorUnidad: 1000, precioUnitarioCentavos: 398,  activo: true },
  { id: "makro:sirope-vainilla",  proveedorId: "makro",              insumoId: null,              nombreProducto: "Sirope MC 1kg Vainilla",                         unidadCompra: "botella",         cantidadPorUnidad: 1000, precioUnitarioCentavos: 398,  activo: true },
  { id: "makro:pajitas",          proveedorId: "makro",              insumoId: null,              nombreProducto: "Pajita papel negro 25x8mm bolsa 100ud",          unidadCompra: "bolsa",           cantidadPorUnidad: 100,  precioUnitarioCentavos: 325,  activo: true },
  { id: "makro:pesto",            proveedorId: "makro",              insumoId: "pesto",           nombreProducto: "Salsa pesto genovese en bote 980g",               unidadCompra: "bote",            cantidadPorUnidad: 980,  precioUnitarioCentavos: 814,  activo: true },
  { id: "makro:mayonesa",         proveedorId: "makro",              insumoId: "mayonesa",        nombreProducto: "Mayonesa en cubo 5L (precio c/dto volumen x3)",    unidadCompra: "cubo",            cantidadPorUnidad: 5000, precioUnitarioCentavos: 1271, activo: true },
  { id: "makro:pimientos-piq",    proveedorId: "makro",              insumoId: "pimientos-asados",nombreProducto: "Pimiento piquillo 80/100 en lata 1900g neto",      unidadCompra: "lata",            cantidadPorUnidad: 1900, precioUnitarioCentavos: 1338, activo: true },
  { id: "makro:mantequilla",      proveedorId: "makro",              insumoId: null,              nombreProducto: "Mantequilla pura 1kg",                            unidadCompra: "bloque",          cantidadPorUnidad: 1000, precioUnitarioCentavos: 949,  activo: true },
  { id: "makro:granola",          proveedorId: "makro",              insumoId: null,              nombreProducto: "Granola con frutas bolsa 750g",                   unidadCompra: "bolsa",           cantidadPorUnidad: 750,  precioUnitarioCentavos: 473,  activo: true }
];
