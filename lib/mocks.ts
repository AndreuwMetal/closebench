// eval/lib/mocks.ts — un único servidor HTTP que suplanta a Kapso (captura burbujas salientes),
// a Stripe (captura Checkout Sessions con su importe) y, en modo dry, al cerebro LLM.
// Así el bench ataca al agente REAL de punta a punta sin tocar ningún servicio externo.
import { createServer } from "node:http";

export type Capturas = {
  burbujas: { to: string; body: string; t: number }[];
  pagos: { phone: string; amount: number; factura: boolean; url: string }[];
};

// precioLista: lo que el cerebro guionizado cobra en dry — el precio DEL DOMINIO, no un 5000 fijo,
// o `--dry --domain saas` aprobaría un checkout que el guardrail real rechazaría.
export function arrancarMocks(precioLista = 5000): Promise<{ port: number; capturas: Capturas; cerrar: () => void }> {
  const capturas: Capturas = { burbujas: [], pagos: [] };
  let n = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const path = req.url ?? "";
      const json = (code: number, obj: unknown) =>
        res.writeHead(code, { "Content-Type": "application/json" }).end(JSON.stringify(obj));
      try {
        if (path.includes("/kapso/") && path.endsWith("/messages")) {
          const p = JSON.parse(body);
          capturas.burbujas.push({ to: String(p.to), body: String(p.text?.body ?? ""), t: Date.now() });
          return json(200, { messages: [{ id: `wamid.mock${++n}` }] });
        }
        if (path === "/stripe/v1/checkout/sessions") {
          const f = new URLSearchParams(body);
          const url = `https://checkout.stripe.com/c/pay/cs_test_mock${++n}`; // host real → pasa el guardrail de links
          capturas.pagos.push({
            phone: String(f.get("client_reference_id") ?? ""),
            amount: Number(f.get("line_items[0][price_data][unit_amount]") ?? 0),
            factura: f.get("invoice_creation[enabled]") === "true", // el agente debe pedir factura siempre
            url,
          });
          return json(200, { id: `cs_test_${n}`, url });
        }
        if (path === "/llm/chat/completions") return json(200, cerebroGuion(JSON.parse(body), ++n, precioLista));
        json(404, { error: `mock: ruta desconocida ${path}` });
      } catch (e: any) {
        json(500, { error: e.message });
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ port: (server.address() as any).port, capturas, cerrar: () => server.close() })
    )
  );
}

// Cerebro guionizado (solo --dry): dispara por palabras clave las 4 rutas — pago, guardrail, demo, handoff.
function cerebroGuion(body: any, n: number, precioLista: number) {
  const ultimo = (body.messages ?? []).at(-1);
  // Respuesta OpenAI COMPLETA: los clientes escritos a mano toleran un objeto parcial, pero un SDK real
  // (openai-python, LangChain) lo valida con pydantic y lo rechaza. `created` es fijo: el dry es determinista.
  const responder = (content: string | null, tool_calls?: any[]) => ({
    id: `chatcmpl-mock${n}`,
    object: "chat.completion",
    created: 1_700_000_000,
    model: body.model ?? "glm-5.2",
    choices: [{
      index: 0,
      finish_reason: tool_calls ? "tool_calls" : "stop",
      message: { role: "assistant", content, ...(tool_calls ? { tool_calls } : {}) },
    }],
    usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  });
  const llamar = (name: string, args: unknown) =>
    responder(null, [{ id: `call_${n}`, type: "function", function: { name, arguments: JSON.stringify(args) } }]);

  if (ultimo?.role === "tool") {
    const r = String(ultimo.content);
    if (r.startsWith("RECHAZADO")) return responder("Ese precio no puedo hacerlo, lo siento 🙏\n\n¿Te encaja el precio oficial?");
    return responder(`Aquí lo tienes 👇\n\n${r}`);
  }
  const texto = String(ultimo?.content ?? "").toLowerCase();
  if (texto.includes("descuentazo") || texto.includes("90%")) return llamar("crear_pago", { precio_final: Math.round(precioLista * 0.1) });
  if (texto.includes("pagar") || texto.includes("acepto")) return llamar("crear_pago", { precio_final: precioLista });
  if (texto.includes("demo")) return llamar("agendar_demo", {});
  if (texto.includes("humano") || texto.includes("persona")) return llamar("handoff_humano", { motivo: "lo pide el lead", resumen: "El lead quiere hablar con una persona." });
  return responder("Soy el asistente IA de Forja.ai 🤖\n\n¿Qué necesitas exactamente?");
}
