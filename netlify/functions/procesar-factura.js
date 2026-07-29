// Funcion serverless: lee una factura/albaran de proveedor y devuelve las
// lineas detectadas en formato estructurado, ya matcheadas contra el
// catalogo.
//
// Division de trabajo (a proposito, no es antojadiza):
// - Claude SOLO lee la imagen y matchea contra el catalogo MAESTRO de
//   insumos (nivel 2: mismo insumo, nombre distinto — ej. "jamon cocido"
//   en la factura es el insumo "jamon-york"). Es la unica parte que
//   necesita entender significado, no solo comparar texto.
// - El matcheo contra lo que ESTE proveedor puntual ya vendio antes (nivel
//   1: el mismo texto casi exacto que ya vimos en una factura anterior de
//   el) se hace ACA en Node, de forma deterministica — no hace falta IA
//   para eso, es mas barato y mas confiable, y si matchea a nivel 1 pisa
//   lo que haya dicho Claude a nivel 2 (una coincidencia exacta con el
//   historial del proveedor es mas confiable que una inferencia semantica).
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

// --- Matcheo nivel 1 (deterministico): contra lo que ESTE proveedor ya
// vendio antes. Comparacion de texto normalizado, sin IA. ---

const MARCAS_DIACRITICAS = new RegExp(String.fromCharCode(0x5b, 0x5c, 0x75, 0x30, 0x33, 0x30, 0x30, 0x2d, 0x5c, 0x75, 0x30, 0x33, 0x36, 0x66, 0x5d), "g");

function normalizar(texto) {
  return String(texto || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(MARCAS_DIACRITICAS, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function similitudJaccard(a, b) {
  const setA = new Set(normalizar(a).split(" ").filter(Boolean));
  const setB = new Set(normalizar(b).split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  const interseccion = [...setA].filter((t) => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : interseccion / union;
}

// Si el nombre detectado matchea (exacto o por similitud alta) contra algo
// que este proveedor ya vendio, esa coincidencia pisa lo que haya dicho
// Claude — es mas confiable que una inferencia semantica. Ademas de insumoId,
// esto tambien recupera cantidadPorUnidad si esa linea de proveedor ya tiene
// aprendido cuanto rinde en unidad base (ver comentario en confirmarFactura
// de src/modules/facturas.js sobre como se "aprende" ese valor).
function matchearContraProveedor(nombreDetectado, catalogoProveedor) {
  const nombreNorm = normalizar(nombreDetectado);

  const exacto = catalogoProveedor.find((pi) => normalizar(pi.nombre_producto) === nombreNorm);
  if (exacto) return { insumoId: exacto.insumo_id, confianza: "alta", cantidadPorUnidad: exacto.cantidad_por_unidad ?? null };

  const mejorFuzzy = catalogoProveedor
    .map((pi) => ({ pi, sim: similitudJaccard(nombreDetectado, pi.nombre_producto) }))
    .filter((x) => x.sim >= 0.6)
    .sort((a, b) => b.sim - a.sim)[0];
  if (mejorFuzzy) return { insumoId: mejorFuzzy.pi.insumo_id, confianza: "alta", cantidadPorUnidad: mejorFuzzy.pi.cantidad_por_unidad ?? null };

  return null;
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
            nombreDetectado: {
              type: "string",
              description: "nombre del producto tal como aparece escrito en la factura, SIN corregir ni normalizar"
            },
            cantidad: { type: "number", description: "cantidad comprada de esa linea" },
            unidad: {
              type: "string",
              description: "unidad tal como aparece en la factura (kg, unidad, paquete, caja, etc.). Omitir si no es legible."
            },
            precio: {
              type: "number",
              description: "precio TOTAL de esa linea, en euros. Omitir si no se distingue con claridad — no inventar."
            },
            insumoId: {
              type: ["string", "null"],
              description: "id del catalogo maestro si ES SEMANTICAMENTE el mismo insumo (aunque el nombre sea distinto). null si no hay ninguno claro."
            },
            cantidadPorUnidad: {
              type: "number",
              description: "SOLO si insumoId no es null: cuanto insumo hay, EN SU UNIDAD BASE (la que aparece en el catalogo maestro, ej. 'ml' o 'g'), en UNA de las unidades contadas en 'cantidad'. Hay que RAZONAR el contenido real del paquete, no copiar el numero de 'cantidad' de nuevo. Si 'unidad' indica un paquete multiple (ej. '6 CAJA', '12 UDS') y el nombre del producto o la factura menciona el tamano de cada pieza (ej. '1.5L', '250g'), multiplicalos y convertilos a la unidad base: nombreDetectado 'LECHE BT 1.5L', unidad '6 CAJA', insumo en 'ml' -> cantidadPorUnidad = 6 x 1.5 x 1000 = 9000. Si 'unidad' ya es una sola pieza suelta (ej. '1 BRIK' de 1L), cantidadPorUnidad es el tamano de esa pieza en unidad base (1000). Omitir si no se puede inferir con confianza razonable."
            },
            calculoExplicado: {
              type: "string",
              description: "SOLO junto con cantidadPorUnidad: texto breve y humano mostrando la cuenta para llegar a ese numero, para que se pueda auditar de un vistazo. Ejemplo: '6 botellas x 1.5 L = 9 L por caja'. Omitir si no aplica."
            },
            confianza: { type: "string", enum: ["alta", "media", "sin_match"] }
          },
          required: ["nombreDetectado", "cantidad", "confianza"]
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

  const TIPOS_IMAGEN = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (mediaType !== "application/pdf" && !TIPOS_IMAGEN.includes(mediaType)) {
    return {
      statusCode: 400,
      body: `Formato no soportado (${mediaType}). Usa una foto JPG/PNG o un PDF — por ejemplo, una foto tomada en iPhone (HEIC) no funciona, hay que convertirla o usar la camara del Android.`
    };
  }

  // El catalogo maestro hace falta ANTES de poder armar el pedido a Claude
  // (va en el prompt), asi que esta consulta va primero, sola.
  let catalogoMaestro;
  try {
    catalogoMaestro = await supabaseQuery("/insumos?select=id,nombre,unidad&activo=eq.true&order=nombre.asc");
  } catch (error) {
    return { statusCode: 502, body: `No se pudo consultar el catalogo: ${error.message}` };
  }

  // El catalogo de ESTE proveedor no lo necesita Claude — solo se usa
  // despues, aca en Node, para el matcheo nivel 1. Puede pedirse en
  // paralelo mientras Claude lee la imagen.
  let catalogoProveedor;
  let claudeResponse;
  try {
    [catalogoProveedor, claudeResponse] = await Promise.all([
      supabaseQuery(
        `/proveedor_insumos?proveedor_id=eq.${encodeURIComponent(proveedorId)}&activo=eq.true&select=insumo_id,nombre_producto,cantidad_por_unidad`
      ),
      leerConClaude(mediaType, base64Data, buildCatalogoMaestroTexto(catalogoMaestro))
    ]);
  } catch (error) {
    return { statusCode: 502, body: `No se pudo procesar la factura: ${error.message}` };
  }

  const toolUse = claudeResponse.content.find((block) => block.type === "tool_use");
  if (!toolUse) {
    return { statusCode: 502, body: "La IA no devolvio un resultado estructurado." };
  }

  const catalogoProveedorConNombre = catalogoProveedor.filter((pi) => pi.insumo_id);
  const items = (toolUse.input.items || []).map((item) => {
    const matchProveedor = matchearContraProveedor(item.nombreDetectado, catalogoProveedorConNombre);
    if (matchProveedor) {
      const base = { ...item, insumoId: matchProveedor.insumoId, confianza: matchProveedor.confianza };
      // Si ya sabemos, de una factura anterior de este mismo proveedor, cuanto
      // rinde una unidad de este producto puntual, esa cifra pisa la
      // estimacion fresca de Claude — es dato confirmado, no una inferencia.
      if (matchProveedor.cantidadPorUnidad != null) {
        return {
          ...base,
          cantidadPorUnidad: matchProveedor.cantidadPorUnidad,
          calculoExplicado: `Ya confirmado en una factura anterior de este proveedor: 1 ${item.unidad || "unidad"} = ${matchProveedor.cantidadPorUnidad} ${unidadBaseDe(matchProveedor.insumoId, catalogoMaestro)}.`
        };
      }
      return base;
    }
    return item;
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, tokensUsados: claudeResponse.usage })
  };
};

function buildCatalogoMaestroTexto(catalogoMaestro) {
  return catalogoMaestro.map((i) => `- ${i.id}: ${i.nombre} (unidad: ${i.unidad})`).join("\n") || "(sin insumos cargados)";
}

function unidadBaseDe(insumoId, catalogoMaestro) {
  return catalogoMaestro.find((i) => i.id === insumoId)?.unidad || "unidad";
}

async function leerConClaude(mediaType, base64Data, lineasMaestro) {
  const systemPrompt = `Sos un asistente que lee facturas y albaranes de proveedores para una sandwicheria y extrae cada linea de producto en formato estructurado.

Catalogo maestro de insumos (ingredientes) del negocio:
${lineasMaestro}

Para cada linea de producto real que encuentres en la factura (ignora envases, portes, IVA, totales y devoluciones):
- Capturá el nombre exactamente como aparece impreso en la factura, sin corregir ni normalizar — se usa despues para comparar contra texto de facturas anteriores.
- "cantidad" es el numero de unidades de compra tal como figura en la factura (ej. la columna "Unidades": 1, 6, 3). "unidad" es el formato/envase tal como aparece (ej. "6 CAJA", "1 BRIK", "1 BOLSA"). No los combines ni los conviertas entre si.
- Si un campo (precio, unidad) no es legible con claridad, omitilo en la respuesta en vez de inventar un valor.
- Si el producto ES semanticamente el mismo insumo que algo del catalogo maestro de arriba (aunque el nombre este escrito distinto), asigna ese insumoId con confianza "media". Si no reconoces ningun insumo equivalente, deja insumoId en null y confianza "sin_match". No asumas una equivalencia si no estas razonablemente seguro — es preferible "sin_match" a un match forzado.
- Cuando asignes insumoId, ademas RAZONA cuanto rinde UNA unidad de compra de esa linea, en la unidad base del insumo (campo cantidadPorUnidad) — las facturas de proveedores mayoristas suelen empaquetar varias piezas juntas (ej. una "caja" que en realidad son 6 botellas de 1.5L cada una = 9L por caja) y ese multiplicador casi nunca es 1. Fijate en el nombre del producto y en "Formato"/"unidad" para el tamano de cada pieza y el multiplicador del paquete, y mostra la cuenta en calculoExplicado para que un humano la pueda revisar de un vistazo. Si el envase ya es una sola pieza suelta (ej. "1 BRIK" de 1L), cantidadPorUnidad es simplemente el tamano de esa pieza convertido a unidad base.`;

  // Los PDF se mandan como bloque "document" (Claude los lee pagina por
  // pagina); las fotos como bloque "image". Mismo formato de "source" en
  // ambos casos, solo cambia el "type" del bloque.
  const archivoBlock = mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: mediaType, data: base64Data } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } };

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          archivoBlock,
          { type: "text", text: "Extrae cada linea de producto de esta factura." }
        ]
      }
    ],
    tools: [FACTURA_TOOL],
    tool_choice: { type: "tool", name: "cargar_factura" }
  });
}
