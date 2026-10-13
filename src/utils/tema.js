// Tema visual de la app. Se elige POR DISPOSITIVO (queda en localStorage, no se sincroniza):
// la tablet de la caja puede estar en un tema y el celular del dueno en otro.
//   oscuro     — el de siempre desde el 23/09/2026.
//   claro      — blanco con naranja, como era antes.
//   unicornio  — claro, con colores pastel.
//   auto       — sigue lo que tenga configurado el dispositivo (claro u oscuro).
// El primer dibujo lo resuelve assets/js/tema-inicial.js; esto maneja los cambios.
const CLAVE = "miga_tema";
export const TEMAS = [
  { id: "oscuro", nombre: "Oscuro" },
  { id: "claro", nombre: "Claro" },
  { id: "unicornio", nombre: "Unicornio 🦄" },
  { id: "auto", nombre: "Automático" }
];
const COLOR_BARRA = { oscuro: "#1c242c", claro: "#17324d", unicornio: "#c2287a" };

export function temaGuardado() {
  try {
    const t = localStorage.getItem(CLAVE);
    return TEMAS.some((x) => x.id === t) ? t : "oscuro";
  } catch { return "oscuro"; }
}

function resolver(tema) {
  if (tema !== "auto") return tema;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "oscuro";
}

export function aplicarTema(tema = temaGuardado()) {
  const efectivo = resolver(tema);
  document.documentElement.setAttribute("data-theme", efectivo);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", COLOR_BARRA[efectivo] || COLOR_BARRA.oscuro);
  return efectivo;
}

export function guardarTema(tema) {
  try { localStorage.setItem(CLAVE, tema); } catch { /* sin localStorage: vale para esta sesion */ }
  return aplicarTema(tema);
}

// Con "Automatico", si el dispositivo cambia de claro a oscuro (ej. de noche), la app lo sigue.
export function iniciarTema() {
  aplicarTema();
  try {
    window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (temaGuardado() === "auto") aplicarTema("auto");
    });
  } catch { /* navegador viejo */ }
}
