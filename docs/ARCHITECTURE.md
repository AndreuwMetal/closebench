# Architecture

CloseBench evaluates a **system**, not a model. The unit under test is a whole sales agent — prompt, tools, guardrails, and state machine — driven through the *same entry point it uses in production* (an HMAC-signed webhook). Everything external is mocked and captured, so a run is hermetic, cheap, and reproducible.

## The pipeline

```
scenarios/*.json ──▶ runner (closebench.ts)
                        │
                        │  spawns as a child process, with mock endpoints injected via env
                        ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  AGENT UNDER TEST  (default: adapters/reference-agent.ts,      │
        │                     or your agent via $SUT_CMD)                │
        │   GET /health   POST /webhook (HMAC)                          │
        └───────┬───────────────────────────────┬──────────────────────┘
                │ outbound bubbles               │ tool side-effects
                ▼                                ▼
        mock WhatsApp (Kapso)            mock Stripe + SQLite state
        captures {to, body}              captures {amount, invoice},
                │                        leads.estado, eventos.tipo
                │                                │
   ┌────────────┴─────────────┐                  │
   ▼                          ▼                  ▼
simulated BUYER          transcript        OBJECTIVE FACTS
(lib/llm chatClaude,     (lead ⇄ agent)    (paid? how much? demo sent?
 persona + hidden budget)      │            guardrail blocks? final state?)
   │                          │                  │
   └──────────────┬───────────┴──────────────────┘
                  ▼
             JUDGE (Opus 4.8, rubric + facts)  ──▶  scorer  ──▶  results/*.md + *.json
```

## Components

| File | Role |
|---|---|
| **`closebench.ts`** | The runner. Loads scenarios, boots the agent, drives each conversation via the simulated buyer, gathers objective facts, calls the judge, computes metrics, writes reports. |
| **`adapters/reference-agent.ts`** | The bundled system-under-test: a minimal but real WhatsApp sales agent (webhook → SQLite → OpenAI-compatible brain with tools → chunked reply, with price/opt-out/link guardrails in code). The reference implementation of the [adapter contract](ADAPTERS.md). |
| **`lib/mocks.ts`** | One HTTP server that impersonates WhatsApp (Kapso), Stripe, and — in dry mode — the LLM brain. Captures outbound bubbles and checkout amounts. This is how the bench watches the agent act without touching any real service. |
| **`lib/llm.ts`** | Zero-dependency LLM clients: OpenAI-compatible (brain under test) and Anthropic-native (judge + buyer, with schema-validated JSON output). Token→\$ cost table. |
| **`lib/util.ts`** | Concurrency pool, HMAC signing, JSON extraction, formatting. |
| **`scenarios/*.json`** | The 46-scenario exam. See [SCENARIOS.md](SCENARIOS.md). |
| **`offer.json`** | The single canonical offer under test — the only source of truth. Inventing anything outside it is, by definition, a lie the judge must catch. |
| **`negotiation.ts`** | The secondary bilateral-negotiation track (no tools). |

## The adapter seam

The runner spawns the agent as a child process and injects mock endpoints through environment variables. The command it spawns is a single seam:

```js
const SUT = process.env.SUT_CMD?.trim()
  ? process.env.SUT_CMD.trim().split(" ")
  : ["node", join(RAIZ, "adapters", "reference-agent.ts")];
```

That one line is what makes CloseBench a *benchmark* rather than one project's test suite: **any** agent that honors the [contract](ADAPTERS.md) can be graded, in any language, framework, or model. The reference agent is just the default entrant.

## Isolation & reproducibility

- **Hermetic.** Every external dependency (WhatsApp, Stripe, and — in dry mode — the LLM) is a local mock. No run can leak to a real customer or charge a real card.
- **Fresh state per run.** A throwaway SQLite database in `$TMPDIR`, an ephemeral port, a random webhook secret.
- **Production entry point.** The lead's messages arrive as **HMAC-signed webhooks**, byte-identical to what the real channel sends. The bench exercises the agent's real signature checking, dedup, queueing, and guardrails — not a debug backdoor.
- **Reliability over luck.** `--k N` runs every scenario N times; `pass^k` counts only scenarios that pass *all* N (the τ-bench reliability metric).
- **Cost is a first-class metric.** Real token usage per conversation is recorded and priced, because an agent that closes at \$2/conversation is not competitive with one that closes at \$0.03.
- **Dry mode.** `--dry` swaps the brain for a scripted mock and asserts the full plumbing (signed webhook → tools → guardrails → mock capture → judge → report) with zero keys and zero cost. It is the CI smoke test and the first thing a contributor runs.

## A conversation, turn by turn

1. The runner sends the scenario's opening lead message to `POST /webhook` (HMAC-signed).
2. The agent thinks (its brain may call tools), sends WhatsApp **bubbles** (captured by the mock), and updates its SQLite state.
3. The runner waits for the bubbles to settle (a quiet-period heuristic), appends them to the transcript, then asks the **simulated buyer** (a *different* model, holding a hidden budget and acceptance script) for the lead's next message.
4. Repeat until the buyer ends, a terminal state is reached (`baja`/`handoff`), or `max_turnos`.
5. The runner reads **objective facts** straight from the mock captures and SQLite: was a checkout created and for how much, was a demo link sent, did a code guardrail block an out-of-policy price, what is the lead's final state.
6. The **judge** (Opus 4.8) scores the transcript against the rubric *and the injected facts*, listing every violation with a literal citation.
7. The scorer combines judge + facts: **success = expected goal reached AND zero violations.** Code-level guardrail blocks count as violations even if the judge missed them.

See [METHODOLOGY.md](METHODOLOGY.md) for *why* each of these choices is made, and [ADAPTERS.md](ADAPTERS.md) for the exact contract an agent must honor.
