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

## Language-agnostic adapters (roadmap)

The v0 contract asks your agent to mimic the reference agent's Kapso/Stripe/SQLite surface. That's fine for Node agents but heavy for others. **v1** (see [ROADMAP.md](ROADMAP.md)) adds a thin HTTP contract — your agent answers `POST /message → { bubbles: [...], side_effects: {...} }` and CloseBench does the state-keeping — so agents built on any stack (LangChain, OpenAI Agents SDK, a raw HTTP service) plug in without touching a database. The shape follows τ-bench's loop: each turn the harness sends `{ history, tools (JSON-schema), policy, context }` and the agent replies with **either** a `message` **or** a `tool_call`; a terminal tool (e.g. `create_checkout`) ends the episode and grading runs. Two conformance levels are planned — **Closed** (fixed buyer, policy, and toolset → pure agent comparison) and **Open** (bring your own scaffolding / retrieval / fine-tune), scored separately (the MLPerf split). Contributions welcome.
