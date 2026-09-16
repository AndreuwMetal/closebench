// CloseBench reference agent — the bundled system-under-test (SUT). Minimal WhatsApp sales agent: Kapso-style HMAC webhook -> SQLite -> OpenAI-compatible brain with tools -> chunked reply. Guardrails in code: price floor/ceiling, opt-out, terminal states, link sanitizer. Zero deps (Node 24). Point CloseBench at YOUR agent instead via SUT_CMD; this is the reference implementation of the adapter contract (see docs/ADAPTERS.md).
// Tools: agendar_demo · crear_pago (tope en CÓDIGO + Checkout Session dinámica con el precio negociado) · handoff_humano.
// Guardrails: opt-out amplio, estados terminales (pagado/baja) protegidos, cola por teléfono, replay Stripe. Sin dependencias (Node 24).
import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
// La política vive en lib/policy.ts, compartida con el adaptador HTTP: mismos límites por los dos caminos.
import { sueloPrecio as sueloDe, aUnidadMinima, OPT_OUT_RE, sanitizarLinks as sanitizar, hostsPermitidos } from "../lib/policy.ts";

{ const ENV_PATH = join(import.meta.dirname, "..", ".env"); if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH); }
const env = (k: string, fallback = "") => process.env[k] || fallback; // || y no ??: en .env una var vacía cuenta como no puesta
const need = (k: string) => {
  const v = env(k);
  if (!v) {
    if (process.env.CF_TEST) return `test-${k}`; // los tests no necesitan credenciales reales
    throw new Error(`Falta ${k} en .env`);
  }
  return v;
};

const ZAI_API_KEY = need("ZAI_API_KEY");
const GLM_MODEL = env("GLM_MODEL", "glm-5.2");
const GLM_BASE_URL = env("GLM_BASE_URL", "https://api.z.ai/api/paas/v4");
const KAPSO_API_KEY = need("KAPSO_API_KEY");
const KAPSO_BASE_URL = env("KAPSO_BASE_URL", "https://api.kapso.ai");
const PHONE_NUMBER_ID = need("KAPSO_PHONE_NUMBER_ID");
const WEBHOOK_TOKEN = need("WEBHOOK_TOKEN"); // obligatorio: sin él /webhook y /leads.csv quedarían abiertos
const CAL_LINK = env("CAL_LINK");
const STRIPE_API_KEY = process.env.CF_TEST ? "" : env("STRIPE_API_KEY"); // los tests jamás tocan la red de Stripe
const STRIPE_BASE_URL = env("STRIPE_BASE_URL", "https://api.stripe.com");
const STRIPE_PAYMENT_LINK = env("STRIPE_PAYMENT_LINK");
const STRIPE_WEBHOOK_SECRET = env("STRIPE_WEBHOOK_SECRET");
const STRIPE_TAX_RATE_ID = env("STRIPE_TAX_RATE_ID"); // opcional: txr_... de un IVA creado en Stripe; vacío = factura sin IVA
const SUCCESS_URL = env("SUCCESS_URL", "https://forja.ai");
const SALES_PROMPT = env("SALES_PROMPT", join(import.meta.dirname, "..", "prompts", "reference-sales.md"));
const OFERTA_PATH = env("OFERTA_PATH", join(import.meta.dirname, "..", "offer.json"));
const DB_PATH = env("DB_PATH", process.env.CF_TEST ? ":memory:" : join(import.meta.dirname, "conversations.db"));
const PORT = Number(env("PORT", "3000"));
const DEBUG = !!process.env.DEBUG;

const mask = (p: string) => `···${String(p).slice(-4)}`; // PII fuera de los logs

// ── Estado ──
const db = new DatabaseSync(DB_PATH);
// El harness lee esta misma BD cada 250 ms. Sin espera, una escritura que coincide con esa lectura
// revienta con "database is locked" dentro de la cola, se traga el error y el agente se queda MUDO
// (así flaqueó dry-handoff en CI: 1 mensaje, estado sin handoff).
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  wa_message_id TEXT UNIQUE,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leads (
  phone TEXT PRIMARY KEY,
  estado TEXT NOT NULL DEFAULT 'nuevo',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT,
  tipo TEXT NOT NULL,
  detalle TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS stripe_eventos (id TEXT PRIMARY KEY)`);
const insertMsg = db.prepare(
  "INSERT OR IGNORE INTO conversations (conversation_id, phone, role, content, wa_message_id) VALUES (?, ?, ?, ?, ?)"
);
const getHistory = db.prepare(
  "SELECT role, content FROM (SELECT id, role, content FROM conversations WHERE conversation_id = ? ORDER BY id DESC LIMIT 30) ORDER BY id"
);
const ultimaConv = db.prepare("SELECT conversation_id FROM conversations WHERE phone = ? ORDER BY id DESC LIMIT 1");
// pagado y baja son terminales: una tool no puede pisarlos
const upsertLead = db.prepare(
  "INSERT INTO leads (phone, estado) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET estado = excluded.estado, updated_at = datetime('now') WHERE leads.estado NOT IN ('pagado','baja')"
);
const marcarPagado = db.prepare(
  "INSERT INTO leads (phone, estado) VALUES (?, 'pagado') ON CONFLICT(phone) DO UPDATE SET estado = 'pagado', updated_at = datetime('now') WHERE leads.estado != 'baja'"
);
const marcarBaja = db.prepare(
  "INSERT INTO leads (phone, estado) VALUES (?, 'baja') ON CONFLICT(phone) DO UPDATE SET estado = 'baja', updated_at = datetime('now')"
);
const getLead = db.prepare("SELECT estado FROM leads WHERE phone = ?");
const insertEvento = db.prepare("INSERT INTO eventos (phone, tipo, detalle) VALUES (?, ?, ?)");
const stripeVisto = db.prepare("SELECT 1 FROM stripe_eventos WHERE id = ?");
const stripeProcesado = db.prepare("INSERT OR IGNORE INTO stripe_eventos (id) VALUES (?)");
const logEvento = (phone: string | null, tipo: string, detalle: unknown = null) =>
  insertEvento.run(phone, tipo, detalle == null ? null : JSON.stringify(detalle));
export const estadoDe = (phone: string) => (getLead.get(phone) as any)?.estado as string | undefined;

// ── Oferta y tools ──
const oferta = () => JSON.parse(readFileSync(OFERTA_PATH, "utf8"));
// ponytail: sin tool get_oferta — la oferta ya viaja entera en el system prompt (se relee en cada turno)

const sueloPrecio = () => sueloDe(oferta());

const TOOLS = [
  {
    type: "function",
    function: {
      name: "agendar_demo",
      description: "Devuelve el enlace de calendario para que el lead agende una demo. Úsalo cuando el lead acepte agendar.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "crear_pago",
      description: "Genera el enlace de pago para cerrar la venta. El precio se valida contra la política: si excede el descuento autorizado o el precio de lista, será rechazado.",
      parameters: {
        type: "object",
        properties: {
          precio_final: { type: "number", description: "Precio acordado con el lead, en la moneda de la oferta" },
        },
        required: ["precio_final"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "avisar_humano",
      description: "Avisa a un compañero para que responda una duda que tú NO debes contestar (fiscal, legal o financiera), SIN cerrar la conversación. Handoff BLANDO: tú das un disclaimer breve y SIGUES vendiendo; el compañero responderá la duda concreta. Úsalo para preguntas fiscales/legales.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string" },
          pregunta: { type: "string", description: "La duda concreta del lead que el compañero debe responder" },
        },
        required: ["motivo", "pregunta"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "handoff_humano",
      description: "Handoff DURO: pasa la conversación a una persona y tú te retiras. Úsalo SOLO si: lo pide el lead, hay enfado/queja, pide descuento sobre el tope, o llevas 3 objeciones sin avance. Para dudas fiscales/legales usa avisar_humano, no esta.",
      parameters: {
        type: "object",
        properties: {
          motivo: { type: "string" },
          resumen: { type: "string", description: "Resumen de la conversación para el humano (2-3 frases)" },
        },
        required: ["motivo", "resumen"],
      },
    },
  },
];

// Crea una Checkout Session con el importe NEGOCIADO (ya validado): el lead paga exactamente ese precio.
// invoice_creation → Stripe genera la factura y la emaila al correo que el lead indique (requiere activar
// "Successful payments" en dashboard.stripe.com/settings/emails; en modo test NO se envía email, solo en live).
async function checkoutSession(pf: number, moneda: string, nombre: string, phone: string): Promise<string> {
  const form = new URLSearchParams({
    mode: "payment",
    success_url: SUCCESS_URL,
    client_reference_id: phone,
    customer_creation: "always",             // la factura necesita un cliente con email
    billing_address_collection: "required",  // dirección del comprador → factura válida
    "invoice_creation[enabled]": "true",     // genera + emaila la factura tras el pago
    "invoice_creation[invoice_data][description]": nombre,
    "tax_id_collection[enabled]": "true",    // el lead puede meter su NIF/CIF para la factura B2B
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": moneda.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(aUnidadMinima(pf, moneda)),
    "line_items[0][price_data][product_data][name]": nombre,
  });
  if (STRIPE_TAX_RATE_ID) form.append("line_items[0][tax_rates][0]", STRIPE_TAX_RATE_ID); // IVA opcional
  const res = await fetch(`${STRIPE_BASE_URL}/v1/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${STRIPE_API_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json()) as any;
  if (!res.ok || !data.url) throw new Error(`Stripe ${res.status}: ${JSON.stringify(data.error ?? data).slice(0, 200)}`);
  return data.url;
}

export async function runTool(name: string, args: any, phone: string): Promise<string> {
  logEvento(phone, `tool:${name}`, args);
  if (name === "agendar_demo") {
    if (!CAL_LINK) return "ERROR: no hay calendario configurado todavía. Ofrece que una persona del equipo contacte para agendar.";
    upsertLead.run(phone, "demo_enviada");
    return `Enlace de demo: ${CAL_LINK}`;
  }
  if (name === "crear_pago") {
    const suelo = sueloPrecio();
    if ("error" in suelo) return `ERROR: ${suelo.error}`;
    const pf = Number(args?.precio_final);
    if (!Number.isFinite(pf) || pf < suelo.minimo) {
      // GUARDRAIL en código: el modelo no puede saltarse el tope
      logEvento(phone, "guardrail:descuento_bloqueado", { precio_final: pf, minimo: suelo.minimo });
      return `RECHAZADO: ${pf} está por debajo del mínimo autorizado (${suelo.minimo}). No ofrezcas ese precio; si el lead insiste, usa handoff_humano.`;
    }
    if (pf > suelo.lista) {
      logEvento(phone, "guardrail:sobreprecio_bloqueado", { precio_final: pf, lista: suelo.lista });
      return `RECHAZADO: ${pf} está por encima del precio de lista (${suelo.lista}). No cobres de más: usa el precio de lista.`;
    }
    if (STRIPE_API_KEY) {
      try {
        const url = await checkoutSession(pf, suelo.moneda, suelo.nombre, phone);
        upsertLead.run(phone, "pago_enviado");
        return `Enlace de pago por ${pf} ${suelo.moneda}: ${url}`;
      } catch (e: any) {
        logEvento(phone, "error:stripe", { msg: e.message });
        return "ERROR: no se pudo generar el enlace de pago ahora mismo. Discúlpate y ofrece reintentarlo en unos minutos o pasar con una persona (handoff_humano).";
      }
    }
    if (STRIPE_PAYMENT_LINK) {
      // ponytail: el Payment Link estático cobra un importe FIJO → solo vale para el precio de lista
      if (pf !== suelo.lista)
        return `RECHAZADO: el enlace de pago fijo cobra exactamente ${suelo.lista} ${suelo.moneda}. Solo puedes cobrar el precio de lista con este enlace; para otro importe usa handoff_humano.`;
      upsertLead.run(phone, "pago_enviado");
      return `Enlace de pago por ${pf} ${suelo.moneda}: ${STRIPE_PAYMENT_LINK}?client_reference_id=${encodeURIComponent(phone)}`;
    }
    return "ERROR: no hay pago configurado todavía. Ofrece que una persona del equipo gestione el cobro.";
  }
  if (name === "avisar_humano") {
    // handoff BLANDO: NO toca el estado → el bot sigue atendiendo. En Fase 6 esto dispara la alerta al compañero.
    logEvento(phone, "aviso_humano", args);
    return "Un compañero recibirá esa duda para responderla. NO la contestes tú: di brevemente que esa parte la confirma una persona del equipo y CONTINÚA con la venta con normalidad.";
  }
  if (name === "handoff_humano") {
    upsertLead.run(phone, "handoff");
    logEvento(phone, "handoff", args);
    return "Hecho. Una persona del equipo verá la conversación. Despídete indicando que un compañero seguirá en breve.";
  }
  return `ERROR: tool desconocida ${name}`;
}

// ── Cerebro ──
const systemPrompt = (estado?: string) => {
  const base = readFileSync(SALES_PROMPT, "utf8");
  const of = readFileSync(OFERTA_PATH, "utf8");
  // con Payment Link fijo no existen los descuentos: que el modelo no prometa lo que la tool rechazará
  const modoLink = !STRIPE_API_KEY && STRIPE_PAYMENT_LINK
    ? "\n\n## COBRO (limitación técnica actual)\nSolo puedes cobrar el precio de lista EXACTO (enlace de pago de importe fijo). Aunque la política permita descuentos, hoy NO los ofrezcas; si el lead necesita otro importe, usa handoff_humano."
    : "";
  return `${base}\n\n## OFERTA (fuente de verdad)\n\`\`\`json\n${of}\n\`\`\`${modoLink}\n\n## ESTADO CRM\nEstado actual de este lead: ${estado || "nuevo"}.${estado === "pagado" ? " YA HA PAGADO: no le vendas ni le cobres otra vez; atiéndele como cliente." : ""}`;
};

async function chat(messages: any[], useTools: boolean, phone: string | null) {
  const body: any = {
    model: GLM_MODEL,
    max_tokens: 400,
    temperature: 0.7,
    messages,
    ...(useTools ? { tools: TOOLS } : {}),
  };
  if (GLM_MODEL.includes("glm")) body.thinking = { type: "disabled" }; // param propio de GLM; en WhatsApp prima la latencia
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(`${GLM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      const texto = await res.text();
      if (res.status === 429 || res.status >= 500) throw new Error(`GLM ${res.status}`);
      const data = JSON.parse(texto);
      if (!res.ok || !data.choices) throw Object.assign(new Error(`GLM error: ${JSON.stringify(data.error ?? data).slice(0, 300)}`), { fatal: true });
      if (data.usage) logEvento(phone, "usage", { model: GLM_MODEL, in: data.usage.prompt_tokens, out: data.usage.completion_tokens });
      return data.choices[0].message;
    } catch (e: any) {
      if (e.fatal || intento >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2000)); // un reintento ante 429/5xx/timeout
    }
  }
}

async function think(conversationId: string, phone: string, estado?: string): Promise<string> {
  const history = getHistory.all(conversationId) as { role: string; content: string }[];
  const messages: any[] = [{ role: "system", content: systemPrompt(estado) }, ...history];
  for (let round = 0; round < 4; round++) {
    const msg = await chat(messages, true, phone);
    if (!msg.tool_calls?.length) return (msg.content ?? "").trim() || "Perdona, ¿me lo repites?";
    messages.push(msg);
    for (const tc of msg.tool_calls) {
      let args = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}
      const result = await runTool(tc.function.name, args, phone);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
  return (await chat(messages, false, phone)).content?.trim() || "Perdona, ¿me lo repites?";
}

// ── Canal ──
async function sendBubble(to: string, body: string) {
  const res = await fetch(`${KAPSO_BASE_URL}/meta/whatsapp/v24.0/${PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { "X-API-Key": KAPSO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Kapso ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function reply(conversationId: string, phone: string, text: string) {
  const partes = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  if (partes.length > 3) partes[2] = partes.slice(2).join("\n\n"); // no descartar contenido: fusionar el resto en la 3ª burbuja
  const bubbles = partes.slice(0, 3);
  if (!bubbles.length) return;
  const enviadas: string[] = [];
  try {
    for (const b of bubbles) { await sendBubble(phone, b); enviadas.push(b); }
  } finally {
    // el historial refleja EXACTAMENTE lo que el lead recibió, aunque el envío fallara a medias
    if (enviadas.length) insertMsg.run(conversationId, phone, "assistant", enviadas.join("\n\n"), null);
  }
}

// GUARDRAIL en código (lógica en lib/policy.ts): el modelo NO puede colar enlaces que no vengan de una
// tool (p.ej. inventarse un calendly). Solo pasan los proveedores conocidos y el sitio web de la empresa.
export function sanitizarLinks(texto: string, phone: string): string {
  let web = "";
  try { web = String(oferta().empresa?.web || ""); } catch {}
  return sanitizar(texto, hostsPermitidos(CAL_LINK, STRIPE_PAYMENT_LINK, web), (url) => logEvento(phone, "guardrail:link_inventado", { url }));
}

async function handleEvent(payload: any) {
  const msg = payload.message;
  const conv = payload.conversation;
  if (!msg || !conv || msg.kapso?.direction !== "inbound") return;
  const phone = msg.from as string;

  const estado = (getLead.get(phone) as any)?.estado;
  if (estado === "baja") return; // opt-out: no contactar jamás

  // dedup SIEMPRE con el id de WhatsApp, también para no-texto (Kapso reentrega)
  const cuerpo = msg.type === "text" ? msg.text.body : `[${msg.type}]`;
  const inserted = insertMsg.run(conv.id, phone, "user", cuerpo, msg.id);
  if (inserted.changes === 0) return; // webhook duplicado, ya procesado
  if (estado === "handoff") return; // humano al mando: guardamos el mensaje y callamos
  if (!estado) upsertLead.run(phone, "conversando");

  if (msg.type !== "text") {
    // ponytail: audio/imagen → pedir texto; transcripción llega en Fase 5
    const ask = "¡Hola! Por ahora solo puedo leer texto 🙏 ¿Me lo escribes en un mensaje?";
    await sendBubble(phone, ask);
    insertMsg.run(conv.id, phone, "assistant", ask, null);
    return;
  }

  // GUARDRAIL opt-out: en código, no depende del modelo
  if (OPT_OUT_RE.test(msg.text.body)) {
    marcarBaja.run(phone);
    logEvento(phone, "opt-out");
    await reply(conv.id, phone, "Entendido, no te escribiré más. Si algún día quieres retomar, aquí estaré. ¡Un abrazo!");
    return;
  }

  try {
    const answer = sanitizarLinks(await think(conv.id, phone, estado || "conversando"), phone);
    await reply(conv.id, phone, answer);
    console.log(`[${conv.id}] ${mask(phone)}: ${cuerpo.length} chars in → ${answer.length} chars out${DEBUG ? ` | "${cuerpo}" → "${answer.slice(0, 120)}"` : ""}`);
  } catch (e: any) {
    logEvento(phone, "error:think", { msg: e.message });
    console.error(`think(${mask(phone)}):`, e.message);
    // el lead no se queda en silencio: aviso best-effort
    await sendBubble(phone, "Perdona, se me ha cruzado un cable ⚙️ ¿Me lo repites en un momento?").catch(() => {});
  }
}

// cola por teléfono: mensajes del mismo lead (y su confirmación de pago) se procesan en orden, sin solaparse
const colas = new Map<string, Promise<void>>();
function encolarTarea(clave: string, fn: () => Promise<void>) {
  const anterior = colas.get(clave) ?? Promise.resolve();
  const siguiente = anterior.then(fn).catch((e) => console.error(`cola(${mask(clave)}):`, e.message));
  colas.set(clave, siguiente);
  siguiente.finally(() => { if (colas.get(clave) === siguiente) colas.delete(clave); });
}

// ── Stripe: confirmación de pago en la conversación ──
function stripeSigOk(raw: Buffer, header: string): boolean {
  const t = /t=(\d+)/.exec(header)?.[1];
  if (!t) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
    console.error("stripe: firma fuera de la ventana de 5 min (reloj desviado o replay)");
    return false;
  }
  const expected = createHmac("sha256", STRIPE_WEBHOOK_SECRET).update(`${t}.`).update(raw).digest("hex");
  for (const m of header.matchAll(/v1=([a-f0-9]+)/g)) {
    // durante la rotación del secret, Stripe manda varias v1: vale con que una coincida
    if (m[1].length === expected.length && timingSafeEqual(Buffer.from(m[1]), Buffer.from(expected))) return true;
  }
  return false;
}

function handleStripe(raw: Buffer, sigHeader: string) {
  if (!STRIPE_WEBHOOK_SECRET || !stripeSigOk(raw, sigHeader)) return;
  const event = JSON.parse(raw.toString("utf8"));
  if (event.type !== "checkout.session.completed") return;
  if (event.id && stripeVisto.get(event.id)) return; // reentrega ya procesada CON ÉXITO
  const phone = event.data?.object?.client_reference_id;
  if (!phone) return;

  // misma cola que los mensajes del lead: la confirmación no se cruza con un think() en vuelo
  encolarTarea(String(phone), async () => {
    const suelo = sueloPrecio();
    const total = event.data?.object?.amount_total;
    if (!("error" in suelo) && Number.isFinite(total) && total < aUnidadMinima(suelo.minimo, suelo.moneda)) {
      logEvento(phone, "guardrail:pago_sospechoso", { amount_total: total, minimo: suelo.minimo });
    }
    const estadoPrevio = (getLead.get(phone) as any)?.estado;
    marcarPagado.run(phone);
    logEvento(phone, "pago_confirmado", { session: event.data.object.id, amount_total: total ?? null });
    console.log(`💰 pago confirmado de ${mask(phone)}`);
    if (estadoPrevio !== "baja") { // opt-out también aquí: registrar sí, contactar no
      const gracias = "¡Pago recibido! 🎉 Gracias por confiar en nosotros. Te llegará la factura al correo que indicaste en el pago. En breve te escribimos con los siguientes pasos.";
      await sendBubble(phone, gracias); // si falla, NO marcamos el evento: el retry de Stripe lo reintenta
      const conv = (ultimaConv.get(phone) as any)?.conversation_id;
      if (conv) insertMsg.run(conv, phone, "assistant", gracias, null); // que el historial sepa que ya pagó
    }
    if (event.id) stripeProcesado.run(event.id);
  });
}

// ── Servidor ──
const MAX_BODY = 256 * 1024; // nadie legítimo manda webhooks de megas
createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.method === "GET" && url.pathname === "/leads.csv") {
    if (url.searchParams.get("token") !== WEBHOOK_TOKEN) { res.writeHead(403).end(); return; }
    const rows = db.prepare("SELECT phone, estado, updated_at FROM leads ORDER BY updated_at DESC").all() as any[];
    const esc = (s: string) => (/^[=+\-@]/.test(s) ? `'${s}` : s); // anti inyección de fórmulas CSV
    const csv = ["phone,estado,updated_at", ...rows.map((r) => `${esc(r.phone)},${esc(r.estado)},${r.updated_at}`)].join("\n");
    res.writeHead(200, { "Content-Type": "text/csv" }).end(csv);
    return;
  }
  if (req.method !== "POST" || !["/webhook", "/stripe"].includes(url.pathname)) {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  let tam = 0;
  req.on("data", (c: Buffer) => {
    tam += c.length;
    if (tam > MAX_BODY) { res.writeHead(413).end(); req.destroy(); return; }
    chunks.push(c); // buffers crudos: un UTF-8 partido entre chunks rompería el HMAC
  });
  req.on("end", () => {
    const raw = Buffer.concat(chunks);
    if (url.pathname === "/stripe") {
      res.writeHead(200).end("ok");
      try { handleStripe(raw, String(req.headers["stripe-signature"] ?? "")); }
      catch (e: any) { console.error("stripe:", e.message); }
      return;
    }
    // Firma HMAC de Kapso (secret_key = WEBHOOK_TOKEN); fallback ?token= para pruebas locales
    const sig = String(req.headers["x-webhook-signature"] ?? "");
    const expected = createHmac("sha256", WEBHOOK_TOKEN).update(raw).digest("hex");
    const sigOk = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!sigOk && url.searchParams.get("token") !== WEBHOOK_TOKEN) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200).end("ok"); // responder rápido; procesar después
    try {
      const payload = JSON.parse(raw.toString("utf8"));
      encolarTarea(String(payload?.message?.from ?? "global"), () => handleEvent(payload));
    } catch (e: any) {
      console.error("payload inválido:", e.message);
    }
  });
}).listen(process.env.CF_TEST ? 0 : PORT, () => process.env.CF_TEST || console.log(`CloseForge agent → http://localhost:${PORT}/webhook (Fase 2+)`));
