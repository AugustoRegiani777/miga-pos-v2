export const money = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR"
});

export function centsToMoney(cents) {
  return money.format((Number(cents) || 0) / 100);
}

const FECHA_SIMULADA_KEY = "miga_fecha_simulada_TESTING";

// Solo local (tu compu) puede tener efecto — en la tablet real (Netlify)
// esta funcion siempre devuelve null, sin importar que haya en localStorage.
// Defensa en profundidad: aunque alguien pegue esta clave a mano en la
// consola de la tablet real, no hace nada.
function fechaSimuladaOverride() {
  const esLocal = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!esLocal) return null;
  try { return localStorage.getItem(FECHA_SIMULADA_KEY) || null; }
  catch { return null; }
}

function formatFechaISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO() {
  const override = fechaSimuladaOverride();
  if (override) return override;
  return formatFechaISO(new Date());
}

// Reloj simulado (solo entorno local/staging) — deja "pasar de dia" con un
// click para probar arrastre/reportes sin esperar al calendario real. El
// control que llama a estas dos funciones vive en app.js y solo se dibuja
// cuando corre contra staging (ver supabase.js).
export function setFechaSimulada(fechaISO) {
  const esLocal = typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname);
  if (!esLocal) return;
  try {
    if (fechaISO) localStorage.setItem(FECHA_SIMULADA_KEY, fechaISO);
    else localStorage.removeItem(FECHA_SIMULADA_KEY);
  } catch { /* localStorage no disponible */ }
}

// Aritmetica pura sobre los numeros de la fecha (UTC de punta a punta) —
// mismo motivo que fechasEnRango() en backup.js: mezclar getters locales con
// Date.UTC corre la fecha segun la zona horaria del dispositivo.
export function avanzarFechaSimulada() {
  const [year, month, day] = todayISO().split("-").map(Number);
  const siguiente = new Date(Date.UTC(year, month - 1, day + 1));
  const nuevaFecha = `${siguiente.getUTCFullYear()}-${String(siguiente.getUTCMonth() + 1).padStart(2, "0")}-${String(siguiente.getUTCDate()).padStart(2, "0")}`;
  setFechaSimulada(nuevaFecha);
  return nuevaFecha;
}

export function currentTime() {
  return new Date().toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

export function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function slugify(texto) {
  const base = normalizeText(texto).replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return base || `id-${Date.now()}`;
}

export function stockStatus(product) {
  const stock = Number(product.stockActual) || 0;
  if (stock <= 0) return { label: "Sin stock", className: "out" };
  if (stock <= product.umbralBajo) return { label: "Stock bajo", className: "low" };
  return { label: "Disponible", className: "ok" };
}

export function downloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Comparte texto plano (no un archivo) para que entre directo en el cuerpo
// de un mail, WhatsApp, SMS, etc. — usa el share sheet nativo del dispositivo,
// asi que funciona con lo que sea que tenga instalado la tablet (no hace
// falta que la app tenga WhatsApp especificamente).
export async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
    }
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return "clipboard";
  }
  return "unsupported";
}

// Abre el dialogo de impresion nativo del navegador con solo el texto del
// ticket (no toda la pagina). Sirve hoy para imprimir en cualquier impresora
// que ya tenga configurada el dispositivo (o guardar como PDF), y el dia que
// consigan una impresora de tickets/termica, esto ya funciona sin tocar nada.
export function printTicket(title, text) {
  const printWindow = window.open("", "_blank", "width=380,height=600");
  if (!printWindow) return false;
  const safeText = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  printWindow.document.write(`<!doctype html>
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: "Courier New", monospace; font-size: 14px; white-space: pre-wrap; padding: 16px; }
        </style>
      </head>
      <body>${safeText}</body>
    </html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  return true;
}

export async function shareOrDownloadBlob(filename, blob) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function shareOrDownloadText(filename, text, mimeType) {
  return shareOrDownloadBlob(filename, new Blob([text], { type: mimeType }));
}
