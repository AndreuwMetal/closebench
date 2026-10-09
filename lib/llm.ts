// eval/lib/llm.ts — clientes LLM de la eval (fetch puro, cero deps).
// GLM/OpenRouter hablan protocolo OpenAI; el juez y el comprador van por la API nativa de Anthropic.
import { sleep } from "./util.ts";

export type Uso = { entrada: number; salida: number };

// OpenRouter reparte cada petición entre decenas de proveedores (precios ×20 de diferencia, posibles
// cuantizaciones): sin fijar la ruta, un baseline no es reproducible ni su coste es el de PRECIOS.
// Se fija al proveedor oficial del modelo, sin fallback. OPENROUTER_PROVIDER lo sobrescribe.
export const PROVEEDOR_OFICIAL: Record<string, string> = {
  "z-ai/": "z-ai", "moonshotai/": "moonshotai", "qwen/": "alibaba", "anthropic/": "anthropic", "openai/": "openai",
};
export const proveedorOpenRouter = (slug: string): string | undefined =>
  process.env.OPENROUTER_PROVIDER?.trim() || Object.entries(PROVEEDOR_OFICIAL).find(([pre]) => slug.startsWith(pre))?.[1];
export type MensajeChat = { role: "system" | "user" | "assistant"; content: string };
// Bloques de texto para chatClaude: permiten poner cache_control en mitad de un mensaje.
export type BloqueTexto = { type: "text"; text: string; cache_control?: { type: "ephemeral" } };

// $/M tokens para el coste por conversación (jul-2026; verificar en z.ai / anthropic si cambian).
export const PRECIOS: Record<string, { in: number; out: number }> = {
  "glm-5.2": { in: 1.4, out: 4.4 },
  "glm-5.3": { in: 1.4, out: 4.4 },        // docs.z.ai/guides/overview/pricing, 2026-09-15
  "glm-5.3-flash": { in: 0.15, out: 0.5 },
  "z-ai/glm-5.2": { in: 1.4, out: 4.4 },   // vía OpenRouter fijado al proveedor Z.AI (PROVEEDOR_OFICIAL), misma tarifa que directo
  "claude-opus-5": { in: 5, out: 25 },     // cerebro Claude nativo: la entrada llega ya en tokens equivalentes (caché)
  "claude-opus-4-8": { in: 5, out: 25 },
  "anthropic/claude-opus-4.8": { in: 5, out: 25 },
  "claude-sonnet-5": { in: 2, out: 10 },   // tarifa API 1P (antes 3/15: inflaba el coste del comprador)
  // Cerebros Claude nativos (API 1P de Anthropic, tarifas 2026-10-06)
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-fable-5-1": { in: 10, out: 50 },
  "claude-haiku-4-5": { in: 1, out: 5 },
  // Cerebros baseline vía OpenRouter: tarifa del proveedor OFICIAL al que se fija la ruta
  // (openrouter.ai/api/v1/models/<slug>/endpoints, 2026-10-09).
  "anthropic/claude-opus-5": { in: 5, out: 25 },
  "moonshotai/kimi-k3": { in: 3, out: 15 },
  "qwen/qwen3.8-max-0902": { in: 2, out: 6 }, // `qwen/qwen3.8-max` ya no existe en OpenRouter; este es el id con fecha
  "openai/gpt-5.6-sol": { in: 2, out: 10 },
};

const sinPrecio = new Set<string>();
export const costeUSD = (modelo: string, uso: Uso) => {
  const p = PRECIOS[modelo];
  if (!p && (uso.entrada || uso.salida) && !sinPrecio.has(modelo)) {
    sinPrecio.add(modelo);
    console.warn(`⚠️ modelo sin precio en PRECIOS: ${modelo} — el coste reportado será 0`);
  }
  return p ? (uso.entrada / 1e6) * p.in + (uso.salida / 1e6) * p.out : 0;
};

export const sumarUso = (a: Uso, b: Uso): Uso => ({ entrada: a.entrada + b.entrada, salida: a.salida + b.salida });
export const USO_CERO: Uso = { entrada: 0, salida: 0 };

// Error no reintentable (clave mala, petición inválida, refusal…).
export class ErrorLLM extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, timeoutMs = 120_000): Promise<any> {
  for (let intento = 1; ; intento++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const texto = await res.text();
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}: ${texto.slice(0, 200)}`);
      let data: any;
      try { data = JSON.parse(texto); } catch { throw new ErrorLLM(`respuesta no-JSON (HTTP ${res.status}): ${texto.slice(0, 200)}`); }
      if (!res.ok) throw new ErrorLLM(`HTTP ${res.status}: ${texto.slice(0, 300)}`);
      return data;
    } catch (e: any) {
      if (e instanceof ErrorLLM || intento >= 3) throw e;
      await sleep(1500 * 2 ** intento); // 429/5xx/red: backoff y reintento
    }
  }
}

// ── Chat OpenAI-compatible (Z.ai GLM, OpenRouter…) ──
export async function chatOpenAI(opts: {
  baseUrl: string; apiKey: string; modelo: string;
  mensajes: MensajeChat[]; maxTokens?: number; json?: boolean;
}): Promise<{ texto: string; uso: Uso }> {
  const body: any = { model: opts.modelo, max_tokens: opts.maxTokens ?? 500, messages: opts.mensajes };
  if (opts.modelo.includes("glm")) body.thinking = { type: "disabled" }; // param propio de GLM; prima la latencia
  if (opts.json) body.response_format = { type: "json_object" };
  const data = await post(`${opts.baseUrl}/chat/completions`, { Authorization: `Bearer ${opts.apiKey}` }, body);
  if (!data.choices?.length) throw new ErrorLLM(`sin choices: ${JSON.stringify(data.error ?? data).slice(0, 300)}`);
  return {
    texto: (data.choices[0].message?.content ?? "").trim(),
    uso: { entrada: data.usage?.prompt_tokens ?? 0, salida: data.usage?.completion_tokens ?? 0 },
  };
}

// Tokens de entrada "equivalentes" a precio normal: escribir caché (TTL 5 min) cuesta 1,25×, leerla 0,1×.
// Así PRECIOS sigue valiendo tal cual y el coste reportado no se infla ni se esconde con el caché.
export const entradaEquivalente = (u: any): number =>
  Math.round((u?.input_tokens ?? 0) + 1.25 * (u?.cache_creation_input_tokens ?? 0) + 0.1 * (u?.cache_read_input_tokens ?? 0));

// ── API nativa de Anthropic (juez y comprador). Con `schema` fuerza JSON validado. ──
// Nota Opus 4.8 / Sonnet 5: nada de temperature/top_p (400); Sonnet 5 razona por defecto → se desactiva.
export async function chatClaude(opts: {
  modelo: string; system?: string; mensajes: (MensajeChat | { role: "user" | "assistant"; content: BloqueTexto[] })[];
  maxTokens?: number; schema?: object; pensar?: boolean;
}): Promise<{ texto: string; json: any; uso: Uso }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ErrorLLM("Falta ANTHROPIC_API_KEY en .env (la usan el juez y el comprador simulado)");
  const body: any = { model: opts.modelo, max_tokens: opts.maxTokens ?? 1000, messages: opts.mensajes };
  // El system es fijo entre llamadas (rúbrica del juez para todo el dominio; persona del comprador en
  // todos los turnos y las k corridas del escenario): se cachea. Por debajo del mínimo cacheable no cuesta nada.
  if (opts.system) body.system = [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }];
  if (opts.pensar) body.thinking = { type: "adaptive" };
  else if (opts.modelo.startsWith("claude-sonnet-5")) body.thinking = { type: "disabled" };
  if (opts.schema) body.output_config = { format: { type: "json_schema", schema: opts.schema } };
  const data = await post(
    "https://api.anthropic.com/v1/messages",
    { "x-api-key": key, "anthropic-version": "2023-06-01" },
    body,
  );
  if (data.stop_reason === "refusal") throw new ErrorLLM("el modelo declinó la petición (refusal)");
  const texto = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  let json: any = null;
  if (opts.schema) {
    try { json = JSON.parse(texto); }
    catch { throw new ErrorLLM(`JSON inválido del modelo (stop_reason=${data.stop_reason}): ${texto.slice(0, 200)}`); }
  }
  return { texto, json, uso: { entrada: entradaEquivalente(data.usage), salida: data.usage?.output_tokens ?? 0 } };
}

if (import.meta.main) {
  const { default: assert } = await import("node:assert");
  assert.equal(proveedorOpenRouter("z-ai/glm-5.2"), "z-ai");
  assert.equal(proveedorOpenRouter("qwen/qwen3.8-max-0902"), "alibaba");
  assert.equal(proveedorOpenRouter("mistralai/x"), undefined, "sin proveedor conocido no se fija ruta");
  for (const slug of ["z-ai/glm-5.2", "anthropic/claude-opus-5", "moonshotai/kimi-k3", "qwen/qwen3.8-max-0902", "openai/gpt-5.6-sol"])
    assert.ok(PRECIOS[slug] && proveedorOpenRouter(slug), `baseline sin tarifa o sin proveedor: ${slug}`);
  assert.equal(entradaEquivalente({ input_tokens: 100, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10000 }), 2350);
  assert.equal(entradaEquivalente(undefined), 0);
  console.log("llm.ts ok");
}
