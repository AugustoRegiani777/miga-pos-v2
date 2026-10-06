// Avisos de pedidos: "hoy tenés estos" al empezar el día, y "falta una hora"
// antes de cada entrega.
//
// Calculos puros, sin red ni pantalla: reciben la lista de pedidos y la hora
// actual, y devuelven que avisar. Asi se pueden probar sin navegador.
//
// Un pedido ya entregado no avisa nada. Uno cuya hora ya paso tampoco: el
// aviso es para anticiparse, y repetirlo despues solo seria ruido (en la
// pantalla de Pedidos se ve igual que sigue pendiente).

export const MINUTOS_ANTES = 60;

const esDeHoy = (pedido, hoyISO) => String(pedido.fechaHoraRetiro || "").slice(0, 10) === hoyISO;
const pendiente = (pedido) => pedido.estado !== "entregado";

export function pedidosDeHoy(pedidos, hoyISO) {
  return pedidos
    .filter((p) => pendiente(p) && esDeHoy(p, hoyISO))
    .sort((a, b) => String(a.fechaHoraRetiro).localeCompare(String(b.fechaHoraRetiro)));
}

export function horaDe(pedido) {
  const d = new Date(pedido.fechaHoraRetiro);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

// Resumen del dia: "Hoy tenés 3 pedidos: 10:30 Ana, 13:00 Luis, 18:00 Marta".
export function resumenDelDia(pedidos, hoyISO) {
  const hoy = pedidosDeHoy(pedidos, hoyISO);
  if (hoy.length === 0) return null;
  const detalle = hoy.map((p) => `${horaDe(p)} ${p.clienteNombre}`).join(" · ");
  return {
    cantidad: hoy.length,
    texto: `Hoy ${hoy.length === 1 ? "tenés 1 pedido" : `tenés ${hoy.length} pedidos`}: ${detalle}`,
    pedidos: hoy
  };
}

// Pedidos que entran en la ventana de aviso (faltan MINUTOS_ANTES o menos,
// pero todavia no paso la hora). `yaAvisados` son los ids que ya se avisaron,
// para no repetir el mismo aviso cada vez que se revisa.
export function pedidosPorEntregar(pedidos, ahora = new Date(), yaAvisados = new Set()) {
  const limite = ahora.getTime() + MINUTOS_ANTES * 60 * 1000;
  return pedidos
    .filter((p) => {
      if (!pendiente(p) || yaAvisados.has(String(p.id))) return false;
      const t = new Date(p.fechaHoraRetiro).getTime();
      if (Number.isNaN(t)) return false;
      return t > ahora.getTime() && t <= limite;
    })
    .sort((a, b) => String(a.fechaHoraRetiro).localeCompare(String(b.fechaHoraRetiro)));
}

export function textoPorEntregar(pedido, ahora = new Date()) {
  const minutos = Math.max(1, Math.round((new Date(pedido.fechaHoraRetiro).getTime() - ahora.getTime()) / 60000));
  const cuando = minutos >= 60 ? "en 1 hora" : `en ${minutos} min`;
  return `Pedido de ${pedido.clienteNombre} ${cuando} (${horaDe(pedido)})`;
}
