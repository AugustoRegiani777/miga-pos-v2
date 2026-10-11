// Marca "hay cambios del catalogo (precio, oculto, orden...) que todavia no
// llegaron a la nube". Mientras esta puesta, traer el catalogo de la nube
// PISARIA lo que la persona acaba de cambiar con la copia vieja: era uno de los
// dos motivos de que un precio o un producto oculto "volviera" al refrescar
// (el otro era seedDatabase, ver idb.js).
const KEY = "miga_catalogo_pendiente";

export function marcarCatalogoPendiente() {
  try { localStorage.setItem(KEY, "1"); } catch { /* sin localStorage: se ignora */ }
}

export function limpiarCatalogoPendiente() {
  try { localStorage.removeItem(KEY); } catch { /* idem */ }
}

export function hayCatalogoPendiente() {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
