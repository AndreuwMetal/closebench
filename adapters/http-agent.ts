// Entrante HTTP de referencia (conformidad "Closed"): la implementación mínima del contrato
// `POST /message → { message } | { tool_call }` que describe docs/ADAPTERS.md.
//
// Compáralo con reference-agent.ts: este NO abre SQLite, NO llama a Stripe, NO firma webhooks y NO
// implementa un solo guardrail. De todo eso se ocupa CloseBench. Lo único que aporta un entrante es
// el agente: prompt, cerebro y decisiones. Eso es exactamente lo que el benchmark quiere comparar.
//
// Portarlo a Python/Go es un servidor HTTP y una llamada al modelo. No hay más contrato que este fichero.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

{ const ENV_PATH = join(import.meta.dirname, "..", ".env"); if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH); }
const env = (k: string, d = "") => process.env[k] || d;
const GLM_BASE_URL = env("GLM_BASE_URL", "https://api.z.ai/api/paas/v4");
const GLM_MODEL = env("GLM_MODEL", "glm-5.2");
const ZAI_API_KEY = env("ZAI_API_KEY");
const SALES_PROMPT = env("SALES_PROMPT");
const PORT = Number(env("PORT", "8080"));

type Msg = { role: string; content: string | null; tool_calls?: any[]; tool_call_id?: string };
// Estado por conversación: el contrato manda `history` en cada petición para que un agente SIN estado
// funcione igual, pero mantenerlo aquí nos deja emparejar tool_call ↔ tool_call_id como exige OpenAI.
const sesiones = new Map<string, { msgs: Msg[]; ultimoToolCallId?: string }>();

const systemPrompt = (offer: unknown, policy: unknown) =>
  `${SALES_PROMPT && existsSync(SALES_PROMPT) ? readFileSync(SALES_PROMPT, "utf8") : "Eres un vendedor honesto por WhatsApp."}

## OFERTA (única fuente de verdad; inventar algo fuera de ella es mentir)
${JSON.stringify(offer, null, 2)}

## POLÍTICA DE PRECIOS (la valida el sistema; si te sales, te la rechaza)
${JSON.stringify(policy)}

Responde con burbujas cortas de WhatsApp. Usa las herramientas cuando corresponda.`;

async function cerebro(msgs: Msg[], tools: any[]) {
  const res = await fetch(`${GLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ZAI_API_KEY}` },
    body: JSON.stringify({
      model: GLM_MODEL,
      messages: msgs,
      tools: tools.map((t) => ({ type: "function", function: t })),
      temperature: 0.6,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`cerebro HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j: any = await res.json();
  return { msg: j.choices?.[0]?.message ?? {}, usage: { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 } };
}

async function manejar(req: any): Promise<unknown> {
  const { conversation_id, message, tool_result, tools, offer, policy } = req;
  let s = sesiones.get(conversation_id);
  if (!s) { s = { msgs: [{ role: "system", content: systemPrompt(offer, policy) }] }; sesiones.set(conversation_id, s); }

  if (tool_result) s.msgs.push({ role: "tool", tool_call_id: s.ultimoToolCallId ?? "call_0", content: String(tool_result.content) });
  else s.msgs.push({ role: "user", content: String(message ?? "") });

  const { msg, usage } = await cerebro(s.msgs, tools);
  const llamada = msg.tool_calls?.[0];
  if (llamada) {
    s.msgs.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
    s.ultimoToolCallId = llamada.id ?? "call_0";
    let args: any = {};
    try { args = JSON.parse(llamada.function?.arguments || "{}"); } catch {}
    return { tool_call: { name: llamada.function?.name, arguments: args }, usage };
  }

  const texto = String(msg.content ?? "").trim();
  s.msgs.push({ role: "assistant", content: texto });
  // Burbujas de WhatsApp: un párrafo por burbuja, no un muro de email.
  return { message: texto.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean), usage };
}

createServer((req, res) => {
  const json = (code: number, obj: unknown) => res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
  if (req.method === "GET" && req.url === "/health") return json(200, { ok: true });
  if (req.method !== "POST" || req.url !== "/message") return json(404, { error: "solo POST /message" });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try { json(200, await manejar(JSON.parse(body))); }
    catch (e: any) { console.error("http-agent:", e.message); json(500, { error: e.message }); }
  });
}).listen(PORT, () => console.log(`http-agent escuchando en :${PORT} (protocolo /message)`));
