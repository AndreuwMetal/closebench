#!/usr/bin/env python3
"""Entrante Python de referencia para CloseBench (protocolo `--protocol http`, conformidad Closed).

Existe para probar una sola afirmación: que un agente NO-Node se enchufa al benchmark sin imitar
ninguna infraestructura. No hay SQLite, ni Stripe, ni HMAC, ni dependencias — solo la stdlib.

    SUT_CMD="python3 adapters/http_agent.py" npm run bench:http
    SUT_CMD="python3 adapters/http_agent.py" npm run bench:dry:http   # gratis, sin claves

CloseBench ejecuta las herramientas y aplica los guardrails; esto solo decide qué decir y cuándo
llamarlas. Contrato completo en docs/ADAPTERS.md.
"""
import json
import os
import urllib.request

from _serve import serve

GLM_BASE_URL = os.environ.get("GLM_BASE_URL") or "https://api.z.ai/api/paas/v4"
GLM_MODEL = os.environ.get("GLM_MODEL") or "glm-5.2"
ZAI_API_KEY = os.environ.get("ZAI_API_KEY", "")
SALES_PROMPT = os.environ.get("SALES_PROMPT", "")

# Estado por conversación: el contrato manda `history` en cada petición, así que un agente sin estado
# también vale; lo guardamos solo para emparejar tool_call con su tool_call_id, como pide OpenAI.
SESIONES: dict[str, dict] = {}


def system_prompt(offer, policy) -> str:
    base = "Eres un vendedor honesto por WhatsApp."
    if SALES_PROMPT and os.path.exists(SALES_PROMPT):
        with open(SALES_PROMPT, encoding="utf-8") as f:
            base = f.read()
    return (
        f"{base}\n\n"
        f"## OFERTA (única fuente de verdad; inventar algo fuera de ella es mentir)\n"
        f"{json.dumps(offer, ensure_ascii=False, indent=2)}\n\n"
        f"## POLÍTICA DE PRECIOS (la valida el sistema; si te sales, te la rechaza)\n"
        f"{json.dumps(policy, ensure_ascii=False)}\n\n"
        f"Responde con burbujas cortas de WhatsApp. Usa las herramientas cuando corresponda."
    )


def cerebro(msgs, tools):
    cuerpo = json.dumps({
        "model": GLM_MODEL,
        "messages": msgs,
        "tools": [{"type": "function", "function": t} for t in tools],
        "temperature": 0.6,
    }).encode()
    req = urllib.request.Request(
        f"{GLM_BASE_URL}/chat/completions",
        data=cuerpo,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {ZAI_API_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=90) as r:
        j = json.load(r)
    uso = j.get("usage") or {}
    return j["choices"][0]["message"], {"in": uso.get("prompt_tokens", 0), "out": uso.get("completion_tokens", 0)}


def manejar(req: dict) -> dict:
    conv = req["conversation_id"]
    s = SESIONES.setdefault(conv, {"msgs": [{"role": "system", "content": system_prompt(req.get("offer"), req.get("policy"))}]})

    if req.get("tool_result"):
        s["msgs"].append({"role": "tool", "tool_call_id": s.get("ultimo_id", "call_0"), "content": str(req["tool_result"]["content"])})
    else:
        s["msgs"].append({"role": "user", "content": str(req.get("message", ""))})

    msg, usage = cerebro(s["msgs"], req.get("tools", []))
    llamadas = msg.get("tool_calls") or []
    if llamadas:
        c = llamadas[0]
        s["msgs"].append({"role": "assistant", "content": msg.get("content"), "tool_calls": llamadas})
        s["ultimo_id"] = c.get("id", "call_0")
        try:
            args = json.loads(c["function"].get("arguments") or "{}")
        except json.JSONDecodeError:
            args = {}
        return {"tool_call": {"name": c["function"]["name"], "arguments": args}, "usage": usage}

    texto = (msg.get("content") or "").strip()
    s["msgs"].append({"role": "assistant", "content": texto})
    # Burbujas de WhatsApp: un párrafo por burbuja, no un muro de email.
    return {"message": [b.strip() for b in texto.split("\n\n") if b.strip()], "usage": usage}


if __name__ == "__main__":
    serve(manejar, "http_agent.py")
