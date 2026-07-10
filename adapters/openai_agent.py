#!/usr/bin/env python3
"""Entrante con el SDK oficial de OpenAI para CloseBench (`--protocol http`, conformidad Closed).

    pip install -r adapters/requirements-openai.txt
    SUT_CMD="python3 adapters/openai_agent.py" npm run bench:dry:http   # gratis, sin claves
    SUT_CMD="python3 adapters/openai_agent.py" npm run bench:http       # el examen real

Funciona contra cualquier endpoint compatible con OpenAI (el cerebro por defecto del bench es GLM vía
`GLM_BASE_URL`). Usa el cliente `openai`, NO el Agents SDK: ver la nota sobre bucles en docs/ADAPTERS.md
— un framework que ejecuta las herramientas por su cuenta no puede ser conforme a Closed, porque los
guardrails dejarían de ser los mismos para todos los entrantes.
"""
import json
import os

from _serve import serve
from openai import OpenAI

cliente = OpenAI(
    base_url=os.environ.get("GLM_BASE_URL") or "https://api.z.ai/api/paas/v4",
    api_key=os.environ.get("ZAI_API_KEY") or "sin-clave",
)
GLM_MODEL = os.environ.get("GLM_MODEL") or "glm-5.2"
SALES_PROMPT = os.environ.get("SALES_PROMPT", "")

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


def manejar(req: dict) -> dict:
    conv = req["conversation_id"]
    s = SESIONES.setdefault(conv, {"msgs": [{"role": "system", "content": system_prompt(req.get("offer"), req.get("policy"))}]})

    if req.get("tool_result"):
        s["msgs"].append({"role": "tool", "tool_call_id": s.get("ultimo_id", "call_0"), "content": str(req["tool_result"]["content"])})
    else:
        s["msgs"].append({"role": "user", "content": str(req.get("message", ""))})

    r = cliente.chat.completions.create(
        model=GLM_MODEL,
        messages=s["msgs"],
        tools=[{"type": "function", "function": t} for t in req.get("tools", [])],
        temperature=0.6,
    )
    msg = r.choices[0].message
    usage = {"in": r.usage.prompt_tokens if r.usage else 0, "out": r.usage.completion_tokens if r.usage else 0}

    if msg.tool_calls:
        c = msg.tool_calls[0]
        s["msgs"].append(msg.model_dump(exclude_none=True))
        s["ultimo_id"] = c.id or "call_0"
        try:
            args = json.loads(c.function.arguments or "{}")
        except json.JSONDecodeError:
            args = {}
        # Devolvemos la llamada; NO la ejecutamos. La ejecuta CloseBench, con sus guardrails.
        return {"tool_call": {"name": c.function.name, "arguments": args}, "usage": usage}

    texto = (msg.content or "").strip()
    s["msgs"].append({"role": "assistant", "content": texto})
    # Burbujas de WhatsApp: un párrafo por burbuja, no un muro de email.
    return {"message": [b.strip() for b in texto.split("\n\n") if b.strip()], "usage": usage}


if __name__ == "__main__":
    serve(manejar, "openai_agent.py")
