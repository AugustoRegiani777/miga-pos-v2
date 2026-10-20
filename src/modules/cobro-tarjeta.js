// Cobro con tarjeta en el posnet. Contrato y vias de conexion: docs/integracion-posnet/.
//
// La caja pide un cobro (importe + referencia) y espera un resultado final:
//   aprobado | rechazado | cancelado | expirado.
// Solo "aprobado" confirma la venta. Mientras tanto avisa cada cambio de estado (onEstado) para que la
// pantalla muestre que pasa.
//
// Modos (por dispositivo):
//   ninguno    como siempre: se elige Tarjeta y se confirma la venta
//   guiado     la pantalla muestra el monto grande y la persona confirma "Cobrado" a mano
//   simulador  simula un terminal (para probar el flujo sin terminal)
//   terminal   la funcion cobro-terminal habla con el proveedor real
import { tokenDeSesion } from "../db/supabase.js";

const CLAVE_MODO = "miga_posnet";
const CLAVE_ESCENARIO = "miga_posnet_sim"; // aprobado | rechazado | lento
export const MODOS_POSNET = [
  { id: "ninguno", nombre: "Sin posnet" },
  { id: "guiado", nombre: "Posnet guiado" },
  { id: "simulador", nombre: "Posnet simulado" },
  { id: "terminal", nombre: "Posnet integrado" }
];
export const ESTADOS_FINALES = new Set(["aprobado", "rechazado", "cancelado", "expirado"]);
const ESPERA_MAXIMA_MS = 120 * 1000;
const CADA_MS = 1000;

export function modoPosnet() {
  try {
    const m = localStorage.getItem(CLAVE_MODO);
    return MODOS_POSNET.some((x) => x.id === m) ? m : "ninguno";
  } catch { return "ninguno"; }
}
export function guardarModoPosnet(modo) {
  try { localStorage.setItem(CLAVE_MODO, modo); } catch { /* sin localStorage */ }
}
const escenarioSimulador = () => { try { return localStorage.getItem(CLAVE_ESCENARIO) || "aprobado"; } catch { return "aprobado"; } };

async function llamarFuncion(cuerpo) {
  const intentar = async (renovar) => {
    const token = await tokenDeSesion({ renovar });
    return fetch("/.netlify/functions/cobro-terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(cuerpo)
    });
  };
  let res = await intentar(false);
  if (res.status === 401) res = await intentar(true);
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos?.error || `El terminal no respondió (${res.status}).`);
  return datos;
}

const espera = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
});

// Cobro por API (simulador o terminal): crear -> consultar cada 1 s -> estado final.
// `signal` permite cancelar desde la pantalla; en ese caso se le avisa tambien al terminal.
export async function cobrarPorApi({ importeCentavos, referencia, modo, onEstado, signal }) {
  const crear = await llamarFuncion({
    accion: "crear", referencia, importeCentavos, moneda: "EUR",
    ...(modo === "simulador" ? { escenario: escenarioSimulador() } : {})
  });
  onEstado?.(crear.estado, crear);
  let actual = crear;
  const inicio = Date.now();
  while (!ESTADOS_FINALES.has(actual.estado)) {
    if (signal?.aborted) {
      const c = await llamarFuncion({ accion: "cancelar", id: crear.id }).catch(() => ({ estado: "cancelado" }));
      return { aprobado: false, estado: "cancelado", motivo: "Cobro cancelado.", ...c };
    }
    if (Date.now() - inicio > ESPERA_MAXIMA_MS) {
      await llamarFuncion({ accion: "cancelar", id: crear.id }).catch(() => {});
      return { aprobado: false, estado: "expirado", motivo: "Nadie pagó a tiempo." };
    }
    await espera(CADA_MS, signal);
    if (signal?.aborted) continue;
    try {
      actual = await llamarFuncion({ accion: "estado", id: crear.id });
      onEstado?.(actual.estado, actual);
    } catch (error) {
      // un corte de red a mitad: se sigue preguntando, no se da por fallado (el cobro puede estar en curso)
      onEstado?.("reintentando", { motivo: error.message });
    }
  }
  return { aprobado: actual.estado === "aprobado", ...actual };
}

export const TEXTO_ESTADO = {
  enviado: "Enviando el importe al posnet…",
  en_terminal: "Esperando la tarjeta del cliente en el posnet…",
  reintentando: "Sin respuesta, reintentando…",
  aprobado: "Cobro aprobado ✓",
  rechazado: "Cobro rechazado",
  cancelado: "Cobro cancelado",
  expirado: "Se agotó el tiempo"
};
