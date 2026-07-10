#!/usr/bin/env python3
"""Entrante LangChain para CloseBench (protocolo `--protocol http`, conformidad Closed).

    pip install -r adapters/requirements-langchain.txt
    SUT_CMD="python3 adapters/langchain_agent.py" npm run bench:dry:http   # gratis, sin claves
    SUT_CMD="python3 adapters/langchain_agent.py" npm run bench:http       # el examen real

## El detalle que importa

LangChain (y LangGraph, y el Agents SDK de OpenAI) están diseñados para **ejecutar las herramientas
ellos mismos**: `bind_tools` + un `ToolNode` que llama a tu función. En conformidad Closed las ejecuta
CloseBench, porque el guardrail de precio, el opt-out y el sanitizador de enlaces tienen que ser
idénticos para todos los entrantes. Si cada framework trajera su propia `crear_pago`, no estaríamos
comparando agentes: estaríamos comparando quién escribió el guardrail más laxo.

Así que aquí `bind_tools` se usa **solo para el esquema**. Nunca invocamos la herramienta: devolvemos el
`tool_call` al harness y esperamos su `tool_result`. Un framework que insista en cerrar su propio bucle
no encaja en Closed; para eso está el protocolo `webhook` (conformidad Open).
"""
import json
import os

from _serve import serve
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI

GLM_BASE_URL = os.environ.get("GLM_BASE_URL") or "https://api.z.ai/api/paas/v4"
GLM_MODEL = os.environ.get("GLM_MODEL") or "glm-5.2"
ZAI_API_KEY = os.environ.get("ZAI_API_KEY") or "sin-clave"
SALES_PROMPT = os.environ.get("SALES_PROMPT", "")

SESIONES: dict[str, list] = {}


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
    msgs = SESIONES.setdefault(conv, [SystemMessage(system_prompt(req.get("offer"), req.get("policy")))])

    if req.get("tool_result"):
        # El id lo puso el modelo en el AIMessage anterior; LangChain exige emparejarlos.
        ultimo_id = next((tc["id"] for m in reversed(msgs) if isinstance(m, AIMessage) for tc in m.tool_calls), "call_0")
        msgs.append(ToolMessage(content=str(req["tool_result"]["content"]), tool_call_id=ultimo_id))
    else:
        msgs.append(HumanMessage(str(req.get("message", ""))))

    llm = ChatOpenAI(model=GLM_MODEL, base_url=GLM_BASE_URL, api_key=ZAI_API_KEY, temperature=0.6)
    # bind_tools SOLO para el esquema: el harness es quien las ejecuta (ver docstring).
    ai: AIMessage = llm.bind_tools([{"type": "function", "function": t} for t in req.get("tools", [])]).invoke(msgs)
    msgs.append(ai)

    um = ai.usage_metadata or {}
    usage = {"in": um.get("input_tokens", 0), "out": um.get("output_tokens", 0)}

    if ai.tool_calls:
        tc = ai.tool_calls[0]
        return {"tool_call": {"name": tc["name"], "arguments": tc["args"]}, "usage": usage}

    texto = str(ai.content).strip()
    # Burbujas de WhatsApp: un párrafo por burbuja, no un muro de email.
    return {"message": [b.strip() for b in texto.split("\n\n") if b.strip()], "usage": usage}


if __name__ == "__main__":
    serve(manejar, "langchain_agent.py")
