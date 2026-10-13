// Aplica el tema guardado en ESTE dispositivo antes de que se dibuje la pagina (sin destello).
// La logica de cambio vive en src/utils/tema.js; esto es lo minimo para el primer dibujo.
(function () {
  var tema = "oscuro";
  try { tema = localStorage.getItem("miga_tema") || "oscuro"; } catch (e) {}
  var efectivo = tema;
  if (tema === "auto") efectivo = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "oscuro";
  if (efectivo !== "claro" && efectivo !== "unicornio") efectivo = "oscuro";
  document.documentElement.setAttribute("data-theme", efectivo);
})();
