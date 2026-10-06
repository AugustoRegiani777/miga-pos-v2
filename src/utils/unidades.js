// Unidades: el sistema guarda SIEMPRE en la unidad base del insumo (g, ml,
// unidad, rebanada...), pero la persona escribe y lee en la que le resulta
// natural. 1 kg de queso se guarda como 1000 g; 5000 g se leen como "5 kg".
//
// Dos reglas:
//  - LEER: se elige sola la unidad mas corta de leer segun el tamaño
//    (5000 g -> "5 kg", 25 g -> "25 g"). Nadie quiere leer "0,025 kg" de
//    queso en una receta ni "20000 ml" de leche en el stock.
//  - ESCRIBIR: lo elige la persona con un selector al lado del campo, y al
//    guardar se convierte a la unidad base. Nunca se adivina lo que quiso
//    poner: si el selector dice kg, 1 es 1 kg.
//
// Ademas de la familia (masa/volumen) cada insumo puede tener un ENVASE: la
// forma en que uno lo cuenta en la despensa. La leche se consume en ml, pero
// en la heladera se cuentan BOTELLAS; el cafe se gasta en gramos pero se
// compra en BOLSAS. El envase se pasa como { nombre, equivale } — por ejemplo
// { nombre: "botella", equivale: 1000 } — y se suma como una unidad mas, asi
// la misma leche se puede leer y escribir en ml, en L o en botellas.
//
// Lo que NO es un envase: como te lo manda el proveedor (una caja con 4 packs
// de 6 botellas). Eso vive en proveedor_insumos y lo traduce la lectura de
// facturas; al stock llega ya convertido.

const FAMILIAS = [
  { nombre: "masa", base: "g", equivalencias: { g: 1, kg: 1000 } },
  { nombre: "volumen", base: "ml", equivalencias: { ml: 1, l: 1000 } }
];

// Como se escribe cada unidad en pantalla (el resto se muestra tal cual).
const ETIQUETAS = { g: "g", kg: "kg", ml: "ml", l: "L" };

const normalizar = (u) => String(u || "").trim().toLowerCase();

function familiaDe(unidadBase) {
  const u = normalizar(unidadBase);
  return FAMILIAS.find((f) => Object.keys(f.equivalencias).includes(u)) || null;
}

export function etiquetaUnidad(unidad) {
  const u = normalizar(unidad);
  return ETIQUETAS[u] || String(unidad || "");
}

// Las unidades metricas no se pluralizan (son simbolos: "5 kg", nunca "5 kgs"),
// pero las que son palabras si: 90 rebanadas, 2 botellas, 66 unidades. Importa
// porque las dos lecturas van juntas en la misma linea y quedaba "90 rebanada
// · 7,5 paquetes", como si una estuviera a medio escribir.
export function etiquetaUnidadPlural(unidad, valor) {
  const u = normalizar(unidad);
  if (ETIQUETAS[u]) return ETIQUETAS[u];
  const palabra = String(unidad || "");
  if (!palabra || Math.abs(Number(valor)) === 1) return palabra;
  return /[aeiou]$/i.test(palabra) ? `${palabra}s` : `${palabra}es`;
}

// El envase solo cuenta si agrega algo. Queda afuera si:
//  - tiene factor 1 ("1 g = 1 g"): es un insumo sin envase configurado;
//  - se llama igual que la unidad base;
//  - se llama como una unidad que la familia YA conoce. El queso tiene
//    unidadCompra "kg", pero el kilo no es un envase: es la misma medida mas
//    grande, y la familia masa ya lo ofrece. Tratarlo como envase duplicaba la
//    opcion en el selector y hacia leer "3,45 kg · 3,5 kgs".
function envaseUtil(envase, unidadBase) {
  if (!envase || !envase.nombre) return null;
  const equivale = Number(envase.equivale);
  if (!Number.isFinite(equivale) || equivale <= 1) return null;
  const nombre = normalizar(envase.nombre);
  if (nombre === normalizar(unidadBase)) return null;
  const familia = familiaDe(unidadBase);
  if (familia && nombre in familia.equivalencias) return null;
  return { nombre, equivale };
}

// Unidades entre las que se puede elegir para escribir, de la mas chica a la
// mas grande. Una sola = no hace falta selector.
export function unidadesDisponibles(unidadBase, envase = null) {
  const familia = familiaDe(unidadBase);
  const base = familia ? Object.keys(familia.equivalencias) : [normalizar(unidadBase)].filter(Boolean);
  const env = envaseUtil(envase, unidadBase);
  return env ? [...base, env.nombre] : base;
}

export function tieneConversion(unidadBase, envase = null) {
  return unidadesDisponibles(unidadBase, envase).length > 1;
}

// Cuantas unidades base vale una unidad cualquiera (incluido el envase).
function factorDe(unidad, unidadBase, envase) {
  const u = normalizar(unidad);
  const env = envaseUtil(envase, unidadBase);
  if (env && u === env.nombre) return env.equivale;
  const familia = familiaDe(unidadBase);
  if (!familia) return 1;
  return familia.equivalencias[u] || 1;
}

// Lo que escribio la persona -> unidad base del insumo.
export function aBase(valor, unidadElegida, unidadBase, envase = null) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return NaN;
  return n * factorDe(unidadElegida, unidadBase, envase);
}

// Unidad base -> la unidad elegida (para rellenar un campo editable).
export function desdeBase(valorBase, unidadDestino, unidadBase, envase = null) {
  const n = Number(valorBase);
  if (!Number.isFinite(n)) return NaN;
  return n / factorDe(unidadDestino, unidadBase, envase);
}

// Cual conviene para LEER un valor: la mas grande en la que el numero no
// quede por debajo de 1 (5000 g -> kg; 999 g -> g). El cero se muestra en la
// base, que es como se piensa el stock vacio ("0 g", no "0 kg").
export function mejorUnidad(valorBase, unidadBase) {
  const familia = familiaDe(unidadBase);
  if (!familia) return normalizar(unidadBase);
  const n = Math.abs(Number(valorBase) || 0);
  const ordenadas = Object.entries(familia.equivalencias).sort((a, b) => b[1] - a[1]);
  for (const [unidad, factor] of ordenadas) {
    if (n >= factor) return unidad;
  }
  return familia.base;
}

function redondear(n, decimales) {
  return parseFloat(Number(n).toFixed(decimales));
}

// Numero con coma decimal, como se escribe en España. Solo para TEXTO que se
// lee en pantalla.
export function formatearNumero(n, decimales = 2) {
  const redondeado = redondear(n, decimales);
  return String(redondeado).replace(".", ",");
}

// Valor para meter dentro de un <input type="number">. OJO: ahi la coma NO
// sirve — el navegador rechaza "3,45" y deja el campo VACIO, sin avisar. Por
// eso este siempre devuelve punto decimal.
export function paraInput(n, decimales = 3) {
  const redondeado = redondear(n, decimales);
  return Number.isFinite(redondeado) ? String(redondeado) : "";
}

// Texto listo para mostrar: elige la unidad sola y redondea con sentido.
// Los multiplos grandes (kg, L) admiten decimales; la base no necesita tantos.
export function formatearCantidad(valorBase, unidadBase, { unidad, envase = null } = {}) {
  const destino = unidad || mejorUnidad(valorBase, unidadBase);
  const valor = desdeBase(valorBase, destino, unidadBase, envase);
  if (!Number.isFinite(valor)) return `0 ${etiquetaUnidad(unidadBase)}`;
  const esMultiplo = normalizar(destino) !== normalizar(unidadBase);
  const numero = formatearNumero(valor, esMultiplo ? 3 : 1);
  return `${numero} ${etiquetaUnidadPlural(destino, numero.replace(",", "."))}`;
}

// Las dos lecturas juntas, que es como se piensa el stock: la medida y los
// envases. Ej: "5,93 L · 5,9 botellas". Si el insumo no tiene envase, queda
// solo la medida.
export function formatearConEnvase(valorBase, unidadBase, envase = null) {
  const medida = formatearCantidad(valorBase, unidadBase);
  const env = envaseUtil(envase, unidadBase);
  if (!env) return medida;
  const enEnvases = desdeBase(valorBase, env.nombre, unidadBase, envase);
  const numero = formatearNumero(enEnvases, 1);
  return `${medida} · ${numero} ${etiquetaUnidadPlural(env.nombre, numero.replace(",", "."))}`;
}
