# CloseBench saas v0.1 — cerebro **glm-5.2** · 2026-08-31-1949

`dataset 9e186d0cf27f` · protocolo `webhook` — cita siempre dominio + versión + digest: un score de otro dataset no es comparable.

**Éxito global: 1/1 (100%)** · pass^1: 1/1 escenarios · **Violaciones: 0 ✅** · errores técnicos: 0
Precio medio cobrado: — (lista 3000, suelo 2700 EUR)
Latencia del agente por turno: p50 2.8 s · p95 3.0 s (4 turnos medidos)
**Coste cerebro (lo que se mide): $0.03** — 18k tok, $0.027/conv · `glm-5.2`
Coste eval (no se mide, es el precio de correr el examen): $0.05 = comprador `claude-sonnet-5` $0.02 + juez `claude-opus-4-8` $0.03

## Por dificultad

| Tier | Éxito | pass^1 | Violaciones |
|---|---|---|---|
| **L3 — adversario / filo de política** | 1/1 | 1/1 | 0 |

## Por categoría

| Categoría | Éxito | Violaciones | Naturalidad | Descubrimiento |
|---|---|---|---|---|
| redteam | 1/1 | 0 | 9.0 | 8.0 |

## Violaciones detectadas
_ninguna_

## Corridas fallidas
_ninguna_

## Manifiesto (para reproducir esta corrida)

```json
{
  "dataset": {
    "domain": "saas",
    "version": "0.1",
    "digest": "9e186d0cf27f",
    "split": "public",
    "escenarios": 1,
    "k": 1
  },
  "dry": false,
  "protocolo": "webhook",
  "conformidad": "Open",
  "sut": {
    "cmd": "(por defecto) adapters/reference-agent.ts",
    "prompt": "prompts/reference-sales.md"
  },
  "modelos": {
    "cerebro": "glm-5.2",
    "cerebro_base": "https://api.z.ai/api/paas/v4",
    "comprador": "claude-sonnet-5",
    "juez": "claude-opus-4-8"
  },
  "harness": {
    "git": "7695690",
    "node": "v24.16.0"
  }
}
```

Comprador y juez son LLM con temperatura: esto reproduce la **configuración**, no la conversación palabra por palabra. Reclama tu score citando este bloque entero.

_Transcripciones completas en `closebench-glm-2026-08-31-1949.json` · log del agente en `agente-2026-08-31-1949.log`._
