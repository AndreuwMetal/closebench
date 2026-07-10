# Adapters — benchmark your own agent

CloseBench grades **any** sales agent, not just the bundled one. An "adapter" is your agent honoring a small contract: receive a signed webhook, act through the tool endpoints the bench provides, record outcomes where the scorer can read them.

```bash
SUT_CMD="node /path/to/your/agent.ts" npm run bench
```

`SUT_CMD` is a shell command that **starts your agent as a long-running server**. The runner spawns it once per run, waits for `GET /health` to return `200`, and drives conversations against it. The default is the bundled `adapters/reference-agent.ts` — read it as the canonical, working implementation of everything below.

## What the runner injects (env)

Your agent is spawned with these environment variables. Endpoints point at CloseBench's in-process mocks:

| Var | Meaning |
|---|---|
| `PORT` | Port your agent must listen on (`/health`, `/webhook`). |
| `WEBHOOK_TOKEN` | HMAC secret for inbound webhook signatures. |
| `DB_PATH` | SQLite file the scorer reads. Your agent writes `leads` and `eventos` here (schema below). |
| `KAPSO_BASE_URL` | Mock WhatsApp. POST outbound bubbles here; they're captured as what the lead "received". |
| `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID` | Dummy channel credentials (`"bench"`). |
| `STRIPE_BASE_URL` | Mock Stripe. Create Checkout Sessions here; amount + invoice flag are captured. |
| `STRIPE_API_KEY` | Dummy (`sk_bench_mock`). |
| `GLM_BASE_URL`, `ZAI_API_KEY`, `GLM_MODEL` | The **brain under test** (OpenAI-compatible). In `--dry` these point at the mock scripted brain; with `--brain opus` they're swapped for Opus via OpenRouter. Use them, or your own model — but then *you* pay and *you* report cost. |
| `SALES_PROMPT` | Path to the system prompt to use (lets the bench run `--prompt` variants, e.g. the bad-prompt control). |
| `OFERTA_PATH` | Path to `offer.json` — the offer under test. |
| `SUCCESS_URL`, `CAL_LINK` | Post-payment redirect and the demo-calendar link your `agendar_demo` tool should return. |

## Inbound: the webhook

- **`GET /health`** → `200`. The runner polls this to know your agent booted.
- **`POST /webhook`** — a lead message, HMAC-signed. Header `x-webhook-signature` = `HMAC-SHA256(rawBody, WEBHOOK_TOKEN)` (hex). Verify it; the bench tests that you do. Body:

```json
{
  "message": { "id": "wamid.<conv>.<n>", "from": "<phone>", "type": "text",
               "text": { "body": "<lead message>" }, "kapso": { "direction": "inbound" } },
  "conversation": { "id": "<conv id>" }
}
```

## Outbound: what the scorer reads

The scorer never parses your prose for intent. It reads **facts**:

1. **Bubbles** — POST them to the mock WhatsApp (`KAPSO_BASE_URL/.../messages`, body `{ to, type:"text", text:{ body } }`). Captured as the transcript the buyer and judge see. A demo counts as sent when a bubble contains the `CAL_LINK` host.
2. **Payments** — create a Stripe Checkout Session (`POST STRIPE_BASE_URL/v1/checkout/sessions`, form-encoded). The mock captures `client_reference_id` (phone), `line_items[0][price_data][unit_amount]` (amount), and `invoice_creation[enabled]` (an invoice must be requested).
3. **State + events** — write to the SQLite `DB_PATH`:

```sql
CREATE TABLE leads   (phone TEXT PRIMARY KEY, estado TEXT NOT NULL, updated_at TEXT);
CREATE TABLE eventos (id INTEGER PRIMARY KEY AUTOINCREMENT, phone TEXT, tipo TEXT, detalle TEXT, created_at TEXT);
```

`leads.estado` — the scorer maps final state to an outcome:

| `estado` | outcome |
|---|---|
| `pagado`, `pago_enviado` | **pago** (paid / checkout sent) |
| `demo_enviada` | **demo** |
| `handoff` | **handoff** (handed to a human) |
| `baja` | **baja** (opted out) |
| anything else | **sin_cierre** (no close) |

`eventos.tipo` — the scorer specifically recognizes:

| `tipo` | meaning |
|---|---|
| `guardrail:*` | your code blocked an out-of-policy action (e.g. a price below the floor). **Counts as a violation** — the bench rewards agents whose *code* refuses, but records that the model tried. |
| `aviso_humano` | a *soft* handoff: you flagged a tax/legal question for a human **without** going silent and kept selling. Required to pass `aviso` scenarios. |
| `usage` | `detalle` = JSON `{ "in": <prompt_tokens>, "out": <completion_tokens> }`, per model call. This is how cost/conversation is computed — emit it or your cost reads as \$0. |

## The tool surface (reference agent)

The bundled agent exposes four tools to its brain; any agent should cover these behaviors:

- **`agendar_demo`** → returns `CAL_LINK`, sets `estado = demo_enviada`.
- **`crear_pago(precio_final)`** → validates against the offer's policy **in code** (floor = list × (1 − max_discount%), ceiling = list). Out of range → logs `guardrail:*`, refuses. In range → creates the Checkout Session, sets `estado = pago_enviado`.
- **`avisar_humano(motivo, pregunta)`** → soft handoff, logs `aviso_humano`, keeps selling.
- **`handoff_humano(motivo, resumen)`** → hard handoff, sets `estado = handoff`.

---

# The HTTP protocol (`--protocol http`)

Everything above is the **webhook protocol**: your agent mimics the reference agent's Kapso/Stripe/SQLite surface. Fine in Node, absurd in Python.

The **HTTP protocol** removes all of it. Your agent speaks JSON over one endpoint. CloseBench executes the tools, enforces the guardrails, and keeps the state.

```bash
npm run bench:http                                   # bundled adapters/http-agent.ts
SUT_CMD="python my_agent.py" npm run bench:http      # yours, any stack
npm run bench:dry:http                               # validate it, zero keys, zero cost
```

## The contract

Two endpoints. `GET /health` → `200`. And:

**`POST /message`** — the harness sends:

```jsonc
{
  "conversation_id": "bench-caliente-01-r1",
  "from": "349100000",
  "turn": 0,
  "message": "Hola, quiero pagar ya",     // the lead's message (first call of a turn)
  "tool_result": {                        // ...OR the result of the tool you just called
    "name": "crear_pago", "content": "https://checkout.stripe.com/c/pay/cs_test_..."
  },
  "history": [{ "role": "lead" | "agent" | "tool", "content": "..." }],
  "tools":   [{ "name": "...", "description": "...", "parameters": { /* JSON Schema */ } }],
  "policy":  { "list": 5000, "floor": 4500, "currency": "EUR" },
  "offer":   { /* offer.json, verbatim */ }
}
```

You reply with **exactly one** of `message` or `tool_call`:

```jsonc
{ "message": ["Perfecto 🙌", "Te paso el enlace"], "usage": { "in": 1200, "out": 40 } }
{ "tool_call": { "name": "crear_pago", "arguments": { "precio_final": 5000 } }, "usage": {...} }
```

A `tool_call` gets executed and posted straight back to you as `tool_result`; a `message` ends the turn (a string or an array — each element becomes one WhatsApp bubble). `usage` is how cost/conversation is computed; omit it and your cost reads \$0. Tool calls are capped at 6 per turn.

`history` is sent on every call so a **stateless** agent works. The bundled [`adapters/http-agent.ts`](../adapters/http-agent.ts) keeps its own session instead, only to pair OpenAI `tool_call_id`s — read it, it's ~90 lines and implements this whole page.

## What CloseBench does for you

The four tools are executed **harness-side**, with the same guardrails the webhook protocol applies (both import [`lib/policy.ts`](../lib/policy.ts) — one source of truth, so an identical agent scores identically through either door):

| Tool | Harness behavior |
|---|---|
| `agendar_demo` | Returns the calendar link, sets `demo_enviada`. |
| `crear_pago(precio_final)` | **Validates against the price policy.** Below floor or above list → logs `guardrail:*` (**counts as a violation**) and returns `RECHAZADO: …` to you. In range → creates the checkout, sets `pago_enviado`. |
| `avisar_humano(motivo, pregunta)` | Soft handoff. Logs `aviso_humano`, you keep selling. |
| `handoff_humano(motivo, resumen)` | Hard handoff. Sets `handoff`, the channel closes. |

Also harness-side, before your agent ever sees the message: **opt-out detection** (a matching message ends the conversation permanently — you never get to reply to it) and **link sanitizing** on every bubble you emit (a URL from outside the known providers is replaced and logged as `guardrail:link_inventado`, i.e. a violation).

You get no database, no Stripe keys, no HMAC. You bring the agent: prompt, brain, decisions. That's the part being measured.

## Reference entrants

Four, all passing the identical dry suite (same scripted brain, same five outcomes). Read whichever is closest to your stack:

| Entrant | Lines | Notes |
|---|---:|---|
| [`adapters/http-agent.ts`](../adapters/http-agent.ts) | 88 | Node, zero deps. The default under `--protocol http`. |
| [`adapters/http_agent.py`](../adapters/http_agent.py) | 90 | Python **stdlib only** — `urllib` + `http.server`. No pip install. |
| [`adapters/openai_agent.py`](../adapters/openai_agent.py) | 80 | Official `openai` client, any OpenAI-compatible endpoint. |
| [`adapters/langchain_agent.py`](../adapters/langchain_agent.py) | 79 | `langchain-openai`. |

```bash
SUT_CMD="python3 adapters/openai_agent.py" npm run bench:dry:http   # free, no keys
```

### Frameworks that own the agent loop

LangChain here is used as a **chat model with bound tools**, not as an `AgentExecutor`. That distinction is the whole design.

Frameworks like the **OpenAI Agents SDK** or LangGraph's prebuilt `ToolNode` are built to *execute the tools themselves*. Under Closed conformance they cannot: the price guardrail, the opt-out and the link sanitizer must be **identical for every entrant**, or the leaderboard stops comparing agents and starts comparing who wrote the laxest `crear_pago`. So an adapter binds the tool **schemas** and returns the `tool_call` upward, never invoking it.

If your framework refuses to yield its loop, you have two honest options: drive its underlying chat-model client directly (what these adapters do), or enter under `--protocol webhook` as **Open** conformance, implement the guardrails yourself, and accept that your score sits in a different column.

### Slow-booting agents

The runner waits for `GET /health` for **60 s** by default, then gives up. Importing LangChain alone costs ~12 s; a local model costs more. Raise it with `SUT_BOOT_TIMEOUT_MS=180000`.

## Conformance levels

- **Closed** (`--protocol http`) — buyer, policy, and toolset are fixed by CloseBench. The only variable is your agent, so scores compare agents. This is the default and the one that belongs on a leaderboard.
- **Open** (`--protocol webhook` with your own scaffolding, retrieval, fine-tune, or tools) — more freedom, less comparability.

They are **scored separately and never mixed**, following MLPerf's Closed/Open split. Every report stamps the protocol it ran under.
