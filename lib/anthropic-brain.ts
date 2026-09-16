// Cerebro Claude por la API NATIVA de Anthropic (con prompt caching) para agentes que hablan OpenAI.
// El SUT sigue apuntando a GLM_BASE_URL con /chat/completions; este proxy local traduce ida y vuelta.
// Por qué no OpenRouter: la misma ANTHROPIC_API_KEY del juez y cacheo explícito (system + conversación).
import { createServer } from "node:http";

const API = "https://api.anthropic.com/v1/messages";

// Precio de caché (jul-2026): escritura 1,25× entrada, lectura 0,1×. El agente solo reporta
// prompt_tokens/completion_tokens, así que devolvemos entrada EQUIVALENTE: el coste del bench sale exacto.
export const entradaEquivalente = (u: any) =>
  Math.round((u?.input_tokens ?? 0) + 1.25 * (u?.cache_creation_input_tokens ?? 0) + 0.1 * (u?.cache_read_input_tokens ?? 0));

/** Petición OpenAI chat/completions → cuerpo de /v1/messages. */
export function aAnthropic(body: any, effort: string) {
  const system: string[] = [];
  const messages: any[] = [];
  const empujar = (role: string, bloques: any[]) => {
    if (!bloques.length) return;
    const ultimo = messages[messages.length - 1];
    if (ultimo?.role === role) ultimo.content.push(...bloques); // los tool_result de una ronda van en UN mensaje
    else messages.push({ role, content: bloques });
  };
  for (const m of body.messages ?? []) {
    if (m.role === "system") system.push(String(m.content ?? ""));
    else if (m.role === "tool") empujar("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: String(m.content ?? "") }]);
    else if (m.role === "assistant" && m._anthropic_content) empujar("assistant", m._anthropic_content); // thinking intacto dentro de la ronda de tools
    else if (m.role === "assistant") {
      const bloques: any[] = m.content ? [{ type: "text", text: String(m.content) }] : [];
      for (const tc of m.tool_calls ?? [])
        bloques.push({ type: "tool_use", id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}") });
      empujar("assistant", bloques);
    } else empujar("user", [{ type: "text", text: String(m.content ?? "") }]);
  }
  return {
    model: body.model,
    // el agente pide 400 pensando en GLM sin razonar; con thinking adaptativo eso cortaría la respuesta
    max_tokens: Math.max(Number(body.max_tokens) || 0, 8000),
    thinking: { type: "adaptive" },
    output_config: { effort },
    cache_control: { type: "ephemeral" }, // automático: la conversación crece turno a turno y se relee de caché
    // prompt + oferta: idénticos en todas las conversaciones del run → se comparten entre leads
    system: [{ type: "text", text: system.join("\n\n"), cache_control: { type: "ephemeral" } }],
    messages,
    ...(body.tools?.length
      ? { tools: body.tools.map((t: any) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
      : {}),
  };
}

/** Respuesta de /v1/messages → respuesta OpenAI chat/completions. */
export function aOpenAI(data: any) {
  const texto = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  const tool_calls = (data.content ?? []).filter((b: any) => b.type === "tool_use")
    .map((b: any) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
  return {
    choices: [{
      message: {
        role: "assistant",
        content: texto || null,
        ...(tool_calls.length ? { tool_calls, _anthropic_content: data.content } : {}),
      },
      finish_reason: data.stop_reason,
    }],
    usage: { prompt_tokens: entradaEquivalente(data.usage), completion_tokens: data.usage?.output_tokens ?? 0 },
  };
}

export async function arrancarCerebroAnthropic(apiKey: string, effort = "low"): Promise<{ base: string; cerrar: () => void }> {
  const srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      try {
        const r = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify(aAnthropic(JSON.parse(raw), effort)),
          signal: AbortSignal.timeout(120_000),
        });
        const data: any = await r.json();
        if (!r.ok) { res.writeHead(r.status, { "Content-Type": "application/json" }).end(JSON.stringify(data)); return; }
        if (data.stop_reason === "refusal") console.warn("⚠️ cerebro Claude: refusal", data.stop_details?.category ?? "");
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(aOpenAI(data)));
      } catch (e: any) {
        res.writeHead(502, { "Content-Type": "application/json" }).end(JSON.stringify({ error: e.message })); // el agente reintenta 5xx
      }
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${(srv.address() as any).port}`, cerrar: () => srv.close() };
}

// Autocomprobación de la traducción (sin red): node lib/anthropic-brain.ts
if (import.meta.main) {
  const { default: assert } = await import("node:assert");
  const pet = aAnthropic({
    model: "claude-opus-5", max_tokens: 400, temperature: 0.7,
    tools: [{ type: "function", function: { name: "agendar_demo", description: "d", parameters: { type: "object", properties: {} } } }],
    messages: [
      { role: "system", content: "PROMPT" },
      { role: "user", content: "hola" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", function: { name: "agendar_demo", arguments: "{}" } }, { id: "t2", function: { name: "agendar_demo", arguments: "{}" } }],
        _anthropic_content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "tool_use", id: "t1", name: "agendar_demo", input: {} }, { type: "tool_use", id: "t2", name: "agendar_demo", input: {} }] },
      { role: "tool", tool_call_id: "t1", content: "ok1" },
      { role: "tool", tool_call_id: "t2", content: "ok2" },
    ],
  }, "low");
  assert.equal((pet as any).temperature, undefined, "Opus 5 rechaza temperature");
  assert.equal(pet.system[0].text, "PROMPT");
  assert.equal(pet.messages[1].content[0].type, "thinking", "el thinking vuelve intacto en la ronda de tools");
  assert.equal(pet.messages.length, 3, "los dos tool_result van en un único mensaje de usuario");
  assert.deepEqual(pet.messages[2].content.map((b: any) => b.tool_use_id), ["t1", "t2"]);
  assert.equal(pet.tools![0].input_schema.type, "object");
  const resp = aOpenAI({ stop_reason: "tool_use", content: [{ type: "text", text: "Te lo paso" }, { type: "tool_use", id: "x", name: "agendar_demo", input: {} }],
    usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000, output_tokens: 7 } });
  assert.equal(resp.choices[0].message.tool_calls![0].function.arguments, "{}");
  assert.equal(resp.usage.prompt_tokens, 100 + 1250 + 1000, "entrada equivalente con precios de caché");
  console.log("✅ anthropic-brain OK");
}
