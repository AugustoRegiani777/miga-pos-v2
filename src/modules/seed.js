export const DB_NAME = "miga-pos-local";
export const DB_VERSION = 6;

export const STORE_NAMES = [
  "categorias",
  "productos",
  "produccion_diaria",
  "ventas",
  "detalle_venta",
  "movimientos_stock",
  "configuracion",
  "cierres_diarios"
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
