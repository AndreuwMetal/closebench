"""Andamiaje HTTP compartido por los entrantes Python de CloseBench.

No es parte del contrato — el contrato son dos endpoints y un JSON (docs/ADAPTERS.md). Está aquí solo
para que `http_agent.py` y `langchain_agent.py` no repitan cuarenta líneas de `BaseHTTPRequestHandler`.
"""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


def serve(manejar: Callable[[dict], dict], nombre: str) -> None:
    """Arranca el servidor del entrante. `manejar` recibe el cuerpo de POST /message y devuelve la respuesta."""
    port = int(os.environ.get("PORT", "8080"))

    class Handler(BaseHTTPRequestHandler):
        def _json(self, code: int, obj) -> None:
            cuerpo = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)

        def do_GET(self):
            self._json(200, {"ok": True}) if self.path == "/health" else self._json(404, {"error": "no"})

        def do_POST(self):
            if self.path != "/message":
                return self._json(404, {"error": "solo POST /message"})
            n = int(self.headers.get("Content-Length", 0))
            try:
                self._json(200, manejar(json.loads(self.rfile.read(n))))
            except Exception as e:  # noqa: BLE001 — el harness lo registra como error técnico de la corrida
                print(f"{nombre}: {e}", flush=True)
                self._json(500, {"error": str(e)})

        def log_message(self, *_):  # silencio: el runner ya captura el stdout del agente
            pass

    print(f"{nombre} escuchando en :{port} (protocolo /message)", flush=True)
    # Threading: el runner corre varias conversaciones en paralelo contra el mismo proceso.
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
