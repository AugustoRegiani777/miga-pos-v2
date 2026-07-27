// Funcion serverless: lee una factura/albaran de proveedor con la API de
// Claude y devuelve las lineas detectadas en formato estructurado.
//
// La imagen NUNCA se guarda — viaja de la tablet a esta funcion, de aca a
// Claude, y la respuesta vuelve a la tablet. No se escribe en Supabase ni en
// ningun storage. Nada se carga al stock desde aca: esta funcion solo LEE y
// devuelve datos; la escritura real pasa por la pantalla de revision humana
// en la app (ver src/modules/facturas.js).
//
// Variables de entorno requeridas en Netlify (Site settings > Environment
// variables): ANTHROPIC_API_KEY y SUPABASE_SERVICE_ROLE_KEY.

const AnthropicModule = require("@anthropic-ai/sdk");
const Anthropic = AnthropicModule.default || AnthropicModule;

const SUPABASE_URL = "https://iknytfgqkdddtqpykgab.supabase.co";

async function supabaseQuery(path) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`
    }
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`Supabase respondio ${res.status} en ${path}: ${texto}`);
  }
  return res.json();
}

const FACTURA_TOOL = {
  name: "cargar_factura",
  description: "Registra cada linea de producto detectada en la factura.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            insumoId: {
              type: ["string", "null"],
              description: "id del insumo del catalogo maestro si hay una coincidencia clara, null si no hay ninguna."
            },
            nombreDetectado: {
              type: "string",
              description: "nombre del producto tal como aparece escrito en la factura"
            },
            cantidad: { type: "number", description: "cantidad comprada de esa linea" },
            unidad: {
              type: "string",
              description: "unidad tal como aparece en la factura (kg, unidad, paquete, caja, etc.)"
            },
            precio: { type: "number", description: "precio TOTAL de esa linea, en euros" },
            confianza: { type: "string", enum: ["alta", "media", "sin_match"] }
          },
          required: ["nombreDetectado", "cantidad", "unidad", "precio", "confianza"]
        }
      }
    },
    required: ["items"]
  }
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: "JSON invalido." };
  }

  const { proveedorId, imagen } = payload;
  if (!proveedorId || !imagen) {
    return { statusCode: 400, body: "Falta proveedorId o imagen." };
  }

  const match = /^data:([^;]+);base64,(.+)$/.exec(imagen);
  if (!match) {
    return { statusCode: 400, body: "La imagen debe venir como data URL en base64." };
  }
  const [, mediaType, base64Data] = match;

  let catalogoMaestro;
  let catalogoProveedor;
  let proveedorRows;
  try {
    [catalogoMaestro, catalogoProveedor, proveedorRows] = await Promise.all([
      supabaseQuery("/insumos?select=id,nombre,unidad&activo=eq.true&order=nombre.asc"),
      supabaseQuery(
        `/proveedor_insumos?proveedor_id=eq.${encodeURIComponent(proveedorId)}&activo=eq.true&select=insumo_id,nombre_producto`
      ),
      supabaseQuery(`/proveedores?id=eq.${encodeURIComponent(proveedorId)}&select=nombre`)
    ]);
  } catch (error) {
    return { statusCode: 502, body: `No se pudo consultar el catalogo: ${error.message}` };
  }

  const proveedorNombre = proveedorRows[0]?.nombre || proveedorId;

  const lineasMaestro =
    catalogoMaestro.map((i) => `- ${i.id}: ${i.nombre} (unidad: ${i.unidad})`).join("\n") || "(sin insumos cargados)";
  const lineasProveedor =
    catalogoProveedor
      .filter((pi) => pi.insumo_id)
      .map((pi) => `- "${pi.nombre_producto}" -> insumoId: ${pi.insumo_id}`)
      .join("\n") || "(este proveedor todavia no tiene productos conocidos)";

  const systemPrompt = `Sos un asistente que lee facturas y albaranes de proveedores para una sandwicheria y extrae cada linea de producto en formato estructurado.

Catalogo maestro de insumos (ingredientes) del negocio:
${lineasMaestro}

Productos que el proveedor "${proveedorNombre}" ya vendio antes, con el nombre exacto que usa en sus facturas:
${lineasProveedor}

Para cada linea de producto real que encuentres en la factura (ignora envases, portes, IVA, totales y devoluciones):
1. Si el nombre coincide -aunque sea con variacion de texto- con algo de la lista de productos de ESTE proveedor, usa ese insumoId con confianza "alta".
2. Si no coincide con nada de ese proveedor pero SI es semanticamente el mismo insumo que algo del catalogo maestro (nombre distinto, mismo ingrediente real), usa ese insumoId con confianza "media".
3. Si no coincide con nada, deja insumoId en null y confianza "sin_match".`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let response;
  try {
    response = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
            { type: "text", text: "Extrae cada linea de producto de esta factura." }
          ]
        }
      ],
      tools: [FACTURA_TOOL],
      tool_choice: { type: "tool", name: "cargar_factura" }
    });
  } catch (error) {
    return { statusCode: 502, body: `No se pudo leer la factura con la IA: ${error.message}` };
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    return { statusCode: 502, body: "La IA no devolvio un resultado estructurado." };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: toolUse.input.items || [] })
  };
};
