// Adaptador HTTP agnóstico de lenguaje (conformidad "Closed").
//
// El contrato del webhook obliga al agente a imitar la superficie Kapso/Stripe/SQLite del agente de
// referencia: razonable en Node, absurdo en Python. Aquí el agente solo habla HTTP y JSON:
//
//   POST /message  →  { message } | { tool_call }
//
// CloseBench ejecuta las herramientas y aplica los guardrails (lib/policy.ts, los mismos que el
// webhook), y se queda con el estado. El agente no toca ninguna base de datos ni ningún mock.
// Ese reparto ES el nivel de conformidad "Closed": comprador, política y herramientas fijos, de modo
// que lo único que se compara entre entrantes es el agente.
import type { Capturas } from "./mocks.ts";
import { sueloPrecio, aUnidadMinima, OPT_OUT_RE, sanitizarLinks, hostsPermitidos } from "./policy.ts";

export const TOOLS_HTTP = [
  { name: "agendar_demo", description: "Devuelve el enlace de calendario para que el lead agende una demo.", parameters: { type: "object", properties: {}, required: [] } },
  { name: "crear_pago", description: "Genera el enlace de pago. El precio se valida contra la política: fuera del rango autorizado, se rechaza.", parameters: { type: "object", properties: { precio_final: { type: "number" } }, required: ["precio_final"] } },
  { name: "avisar_humano", description: "Handoff BLANDO: avisa a un compañero de una duda fiscal/legal/financiera que tú NO debes contestar, y SIGUES vendiendo.", parameters: { type: "object", properties: { motivo: { type: "string" }, pregunta: { type: "string" } }, required: ["motivo"] } },
  { name: "handoff_humano", description: "Handoff DURO: cede la conversación a una persona y deja de responder.", parameters: { type: "object", properties: { motivo: { type: "string" }, resumen: { type: "string" } }, required: ["motivo"] } },
];

const DESPEDIDA_OPTOUT = "Entendido, no te escribiré más. Si algún día quieres retomar, aquí estaré. ¡Un abrazo!";
const MAX_TOOLS_POR_TURNO = 6; // ponytail: cota dura contra un agente que llame herramientas en bucle

export type CtxHttp = {
  sutUrl: string;
  phone: string;
  convId: string;
  oferta: any;
  calLink: string;
  capturas: Capturas;
  timeoutMs: number;
  getEstado: () => string | undefined;
  setEstado: (estado: string) => void;
  logEvento: (tipo: string, detalle: unknown) => void;
};

type RespuestaSut = { message?: string | string[]; tool_call?: { name: string; arguments?: any }; usage?: { in?: number; out?: number } };

// Ejecuta una herramienta del lado del harness. Devuelve lo que el agente verá como resultado.
// Es aquí, y en ningún otro sitio, donde vive la política de precios para los entrantes HTTP.
function ejecutarTool(ctx: CtxHttp, name: string, args: any): string {
  if (name === "agendar_demo") {
    ctx.setEstado("demo_enviada");
    return ctx.calLink;
  }
  if (name === "crear_pago") {
    const suelo = sueloPrecio(ctx.oferta);
    if ("error" in suelo) return `ERROR: ${suelo.error}`;
    const pf = Number(args?.precio_final);
    if (!Number.isFinite(pf)) return "ERROR: precio_final no es un número.";
    if (pf < suelo.minimo) {
      ctx.logEvento("guardrail:descuento_bloqueado", { precio_final: pf, minimo: suelo.minimo });
      return `RECHAZADO: ${pf} está por debajo del mínimo autorizado (${suelo.minimo}). No ofrezcas ese precio; si el lead insiste, usa handoff_humano.`;
    }
    if (pf > suelo.lista) {
      ctx.logEvento("guardrail:sobreprecio_bloqueado", { precio_final: pf, lista: suelo.lista });
      return `RECHAZADO: ${pf} está por encima del precio de lista (${suelo.lista}).`;
    }
    const url = `https://checkout.stripe.com/c/pay/cs_test_http${ctx.capturas.pagos.length + 1}`;
    // factura: true — en conformidad Closed la pide el harness, no el agente (contrato idéntico para todos).
    ctx.capturas.pagos.push({ phone: ctx.phone, amount: aUnidadMinima(pf, suelo.moneda), factura: true, url });
    ctx.setEstado("pago_enviado");
    return url;
  }
  if (name === "avisar_humano") {
    ctx.logEvento("aviso_humano", args ?? {});
    return "Aviso enviado a un compañero. Da un disclaimer breve, NO respondas la duda, y sigue con la venta.";
  }
  if (name === "handoff_humano") {
    ctx.setEstado("handoff");
    ctx.logEvento("handoff", args ?? {});
    return "Handoff hecho: una persona toma la conversación. Despídete y no sigas vendiendo.";
  }
  return `ERROR: herramienta desconocida "${name}".`;
}

// Mismo contrato que el canal webhook: `entregar` empuja el mensaje del lead, `recoger` devuelve las
// burbujas de ese turno. En webhook las dos fases están realmente separadas (el agente responde async);
// aquí el POST es síncrono y `recoger` solo vacía el búfer. Mantener la forma deja el bucle intacto.
export type Canal = { entregar: (texto: string, n: number) => Promise<void>; recoger: () => Promise<string[]> };

/**
 * Canal HTTP. El historial vive aquí: un agente sin estado puede reconstruirlo entero en cada llamada.
 */
export function crearCanalHttp(ctx: CtxHttp): Canal {
  const historial: { role: string; content: string }[] = [];
  let buffer: string[] = [];
  const suelo = sueloPrecio(ctx.oferta);
  const politica = "error" in suelo ? { error: suelo.error } : { list: suelo.lista, floor: suelo.minimo, currency: suelo.moneda };
  const permitidos = hostsPermitidos(ctx.calLink, "", String(ctx.oferta?.empresa?.web ?? ""));

  const emitir = (texto: string): string => {
    const limpio = sanitizarLinks(texto, permitidos, (url) => ctx.logEvento("guardrail:link_inventado", { url }));
    ctx.capturas.burbujas.push({ to: ctx.phone, body: limpio, t: Date.now() });
    historial.push({ role: "agent", content: limpio });
    return limpio;
  };

  const pedir = async (cuerpo: unknown): Promise<RespuestaSut> => {
    const res = await fetch(`${ctx.sutUrl}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    if (!res.ok) throw new Error(`/message HTTP ${res.status}`);
    return (await res.json()) as RespuestaSut;
  };

  const entregar = async (texto: string, turno: number): Promise<void> => {
    const estado = ctx.getEstado();
    if (estado === "baja" || estado === "handoff") return; // canal cerrado: el agente no vuelve a hablar

    historial.push({ role: "lead", content: texto });

    // GUARDRAIL opt-out, en el harness y no en el modelo: idéntico al del agente de referencia.
    if (OPT_OUT_RE.test(texto)) {
      ctx.setEstado("baja");
      ctx.logEvento("opt-out", {});
      buffer.push(emitir(DESPEDIDA_OPTOUT));
      return;
    }

    const base = {
      conversation_id: ctx.convId, from: ctx.phone, turn: turno,
      tools: TOOLS_HTTP, policy: politica, offer: ctx.oferta,
    };
    let cuerpo: any = { ...base, message: texto, history: historial.slice(0, -1) };

    for (let i = 0; i < MAX_TOOLS_POR_TURNO; i++) {
      const r = await pedir(cuerpo);
      if (r.usage) ctx.logEvento("usage", { in: r.usage.in ?? 0, out: r.usage.out ?? 0 });

      if (r.tool_call?.name) {
        const resultado = ejecutarTool(ctx, r.tool_call.name, r.tool_call.arguments ?? {});
        historial.push({ role: "tool", content: `${r.tool_call.name} → ${resultado}` });
        cuerpo = { ...base, history: historial, tool_result: { name: r.tool_call.name, content: resultado } };
        continue;
      }

      const msgs = r.message == null ? [] : Array.isArray(r.message) ? r.message : [r.message];
      for (const m of msgs) if (String(m).trim()) buffer.push(emitir(String(m)));
      return; // un mensaje (o ninguno) cierra el turno
    }
    ctx.logEvento("guardrail:bucle_de_tools", { max: MAX_TOOLS_POR_TURNO });
  };

  const recoger = async (): Promise<string[]> => { const b = buffer; buffer = []; return b; };
  return { entregar, recoger };
}
