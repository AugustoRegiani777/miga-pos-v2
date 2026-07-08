export const money = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR"
});

export function centsToMoney(cents) {
  return money.format((Number(cents) || 0) / 100);
}

export function todayISO() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export async function shareOrDownloadText(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const file = new File([blob], filename, { type: mimeType });
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
