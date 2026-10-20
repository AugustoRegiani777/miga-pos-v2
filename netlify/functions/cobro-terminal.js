// Cobro con tarjeta en un terminal (posnet): la caja pide un cobro por importe y espera el resultado.
//
// Contrato y vias de conexion: docs/integracion-posnet/ (README.md y openapi-cobros.yaml).
// La caja habla SOLO con esta funcion; la clave del proveedor vive aca (variables de entorno de
// Netlify) y nunca llega a la tablet. Para cambiar de proveedor se ajusta SOLO este archivo.
//
//   POST { accion: "crear",    referencia, importeCentavos, moneda? }  -> { id, estado, ... }
//   POST { accion: "estado",   id }                                    -> { id, estado, ... }
//   POST { accion: "cancelar", id }                                    -> { id, estado, ... }
//
// Estados: enviado -> en_terminal -> aprobado | rechazado | cancelado | expirado (los ultimos 4 son finales).
//
// Variables de entorno:
//   COBRO_PROVEEDOR   "simulador" (por defecto) | "generico" (API REST segun openapi-cobros.yaml)
//   COBRO_API_URL, COBRO_API_KEY, COBRO_TERMINAL_ID   (solo "generico")
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            (para comprobar que quien llama esta logueado)

const SUPABASE_URL = process.env.SUPABASE_URL || "https://yfveeikzckvqlndmhwut.supabase.co";
const ESTADOS_FINALES = new Set(["aprobado", "rechazado", "cancelado", "expirado"]);

// --- Quien llama: tiene que ser un usuario logueado de la app (no cualquiera con la URL). ---
async function usuarioLogueado(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "", Authorization: `Bearer ${token}` }
  });
  return res.ok;
}

const respuesta = (status, cuerpo) => ({
  statusCode: status,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo)
});

// ===========================================================================================
// Adaptador SIMULADOR (sin estado): el id lleva la hora de creacion y el escenario, y el estado
// se calcula con el tiempo que paso. Permite probar toda la pantalla sin terminal.
//   sim_<t0>_<escenario>   escenario: aprobado | rechazado | lento (no responde: expira)
// ===========================================================================================
const simulador = {
  crear({ referencia, importeCentavos, escenario = "aprobado" }) {
    const id = `sim_${Date.now()}_${escenario}`;
    return { id, referencia, estado: "enviado", importeCentavos };
  },
  estado(id) {
    const [, t0, escenario] = String(id).split("_");
    const seg = (Date.now() - Number(t0)) / 1000;
    if (!(seg >= 0)) return { id, estado: "expirado", motivo: "Cobro desconocido." };
    if (escenario === "lento") return { id, estado: seg > 20 ? "expirado" : "en_terminal", motivo: seg > 20 ? "Nadie pagó a tiempo." : null };
    if (seg < 1.5) return { id, estado: "enviado" };
    if (seg < 4) return { id, estado: "en_terminal" };
    if (escenario === "rechazado") return { id, estado: "rechazado", motivo: "Tarjeta denegada (simulado)." };
    return { id, estado: "aprobado", autorizacion: "SIM123", ultimos4: "4242", marca: "VISA", referenciaOperacion: "SIM-" + String(id).split("_")[1] };
  },
  cancelar(id) { return { id, estado: "cancelado" }; }
};

// ===========================================================================================
// Adaptador GENERICO: API REST con el contrato de docs/integracion-posnet/openapi-cobros.yaml.
// Cuando BBVA/Redsys entregue su documentacion real se ajustan SOLO estas dos cosas:
//   ESTADOS_PROVEEDOR : como llama el proveedor a cada estado
//   aCobro()          : como vienen los campos de la respuesta
// ===========================================================================================
const ESTADOS_PROVEEDOR = {
  enviado: "enviado", pending: "enviado", created: "enviado",
  en_terminal: "en_terminal", waiting_card: "en_terminal", in_progress: "en_terminal",
  aprobado: "aprobado", approved: "aprobado", succeeded: "aprobado", paid: "aprobado",
  rechazado: "rechazado", declined: "rechazado", failed: "rechazado",
  cancelado: "cancelado", cancelled: "cancelado", canceled: "cancelado",
  expirado: "expirado", expired: "expirado", timeout: "expirado"
};

function aCobro(d) {
  return {
    id: d.id,
    referencia: d.referencia,
    estado: ESTADOS_PROVEEDOR[String(d.estado || "").toLowerCase()] || "enviado",
    importeCentavos: d.importe_centavos ?? null,
    autorizacion: d.autorizacion ?? null,
    ultimos4: d.ultimos4 ?? null,
    marca: d.marca ?? null,
    referenciaOperacion: d.referencia_operacion ?? null,
    motivo: d.motivo ?? null
  };
}

async function llamarProveedor(metodo, ruta, cuerpo, idempotencia) {
  const base = process.env.COBRO_API_URL;
  if (!base || !process.env.COBRO_API_KEY) throw new Error("El proveedor de cobro no está configurado (COBRO_API_URL / COBRO_API_KEY).");
  const res = await fetch(`${base.replace(/\/$/, "")}${ruta}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.COBRO_API_KEY}`,
      ...(idempotencia ? { "Idempotency-Key": idempotencia } : {})
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const texto = await res.text();
  let datos = {};
  try { datos = texto ? JSON.parse(texto) : {}; } catch { /* respuesta no JSON */ }
  if (!res.ok) throw new Error(datos?.message || datos?.error || `El proveedor respondió ${res.status}.`);
  return datos;
}

const generico = {
  async crear({ referencia, importeCentavos, moneda = "EUR" }) {
    const d = await llamarProveedor("POST", "/cobros", {
      referencia,
      importe_centavos: importeCentavos,
      moneda,
      terminal_id: process.env.COBRO_TERMINAL_ID,
      descripcion: "Caja Uno de Miga"
    }, referencia);
    return aCobro({ ...d, referencia });
  },
  async estado(id) { return aCobro(await llamarProveedor("GET", `/cobros/${encodeURIComponent(id)}`)); },
  async cancelar(id) { return aCobro(await llamarProveedor("POST", `/cobros/${encodeURIComponent(id)}/cancelar`)); }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return respuesta(405, { error: "Solo POST." });
  if (!(await usuarioLogueado(event))) return respuesta(401, { error: "Hay que iniciar sesión." });

  let p;
  try { p = JSON.parse(event.body || "{}"); } catch { return respuesta(400, { error: "JSON inválido." }); }
  const proveedor = (process.env.COBRO_PROVEEDOR || "simulador") === "generico" ? generico : simulador;

  try {
    if (p.accion === "crear") {
      const importe = Math.round(Number(p.importeCentavos));
      if (!p.referencia || !(importe > 0)) return respuesta(400, { error: "Falta la referencia o el importe." });
      return respuesta(200, await proveedor.crear({ referencia: String(p.referencia), importeCentavos: importe, moneda: p.moneda, escenario: p.escenario }));
    }
    if (p.accion === "estado" && p.id) return respuesta(200, await proveedor.estado(String(p.id)));
    if (p.accion === "cancelar" && p.id) return respuesta(200, await proveedor.cancelar(String(p.id)));
    return respuesta(400, { error: "Acción desconocida." });
  } catch (error) {
    return respuesta(502, { error: error.message || "No se pudo hablar con el terminal." });
  }
};

exports.ESTADOS_FINALES = ESTADOS_FINALES;
