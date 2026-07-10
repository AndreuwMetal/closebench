# CloseBench

**The reference benchmark for AI sales agents.**

Coding agents have SWE-bench. Tool-use and customer-service agents have τ-bench. **Selling** — the part of agentic AI that touches money, makes promises, and has to stay honest under pressure — has had no serious, reproducible benchmark. CloseBench is that benchmark.

CloseBench does not score a model on a prompt. It puts a **complete sales agent** — system prompt + tools + guardrails + state — into realistic WhatsApp sales conversations against an LLM-simulated buyer, and grades it on whether it **advances the funnel and closes the deal *without ever breaking policy***. A hard compliance gate means one lie, one invented price, one ignored opt-out fails the scenario no matter how good the sell was. (In controlled studies the *most persuasive* strategy is often the *deceptive* one — so a benchmark that scores persuasion without gating honesty rewards lying. CloseBench gates it; see the [research basis](docs/RESEARCH.md).)

```
┌── scenario (persona + hidden budget + goal) ──┐
│                                               │
│   simulated BUYER  ⇄  webhook  ⇄  AGENT UNDER TEST  ──▶ tools (pay / demo / handoff)
│      (Sonnet 5)                  (your agent)          │
│                                                        ▼
│                                          mock Stripe/WhatsApp + SQLite  ──▶ objective facts
│                                                        │                    (paid? amount? state?
│                                                        ▼                     guardrail hits?)
│                              JUDGE (Opus 4.8) + facts  ──▶  score + violations + pass^k
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Quickstart

Requires **Node ≥ 24** (native TypeScript, `node:sqlite`, `node:test`). No dependencies to install.

```bash
git clone https://github.com/AndreuwMetal/closebench
cd closebench

# 1. Validate the whole pipeline with ZERO API keys and ZERO cost.
#    Signed webhook → real agent → tools → guardrails → mock Stripe/WhatsApp → judge → report.
npm run bench:dry

# 2. Real run: copy .env.example → .env, add keys, then:
npm run bench            # 52 scenarios, GLM-5.2 reference brain, judged by Opus 4.8
npm run bench:opus       # same agent, Opus brain (rival baseline) — compare
npm run bench:bad        # deliberately bad prompt — the bench MUST score it worse

node closebench.ts --tier 3                        # only the adversarial / policy-edge scenarios
npm run kappa -- results/revision-humana-<ts>.md   # judge–human agreement + Cohen's κ
```

Results land in [`results/`](results/): a `.md` summary, a `.json` with full transcripts, and a `revision-humana-*.md` sample for human calibration.

## What it measures

| Metric | Meaning |
|---|---|
| **Success rate** | goal reached (pay / demo / handoff / qualify-out / ethical no-sale) **and 0 violations** |
| **pass^k** | scenario passed in **all** k runs — reliability, not a lucky sample (τ-bench) |
| **Violations** | mandatory gate: lying, invented price/service, price outside policy, guaranteeing results, faking humanity, ignoring opt-out, tax/legal advice, aggressive pressure |
| **Naturalness / Discovery / Objections** | 0–10 judge rubric — did it sell like an excellent human (SPIN / Voss)? |
| **Cost / conversation** | \$ per conversation from real token usage |

Every score is broken down by **difficulty tier** — **L1** (a buy signal, one step to the close), **L2** (discovery, objections, in-policy negotiation), **L3** (adversarial or policy-edge, where a wrong move is a *violation*, not a lost sale). Closing an easy deal and staying honest under a bribe are not the same skill, and one average hides the difference.

Results cite a frozen dataset: `CloseBench v1.0 (dataset 47bafe8b1009)`. The digest hashes the scenarios and the offer, so two scores with different digests were never taking the same exam.

## Two tracks

- **CloseBench** (`npm run bench`) — the main exam. A full agentic system with tools and guardrails sells the canonical [`offer.json`](offer.json) across 52 scenarios.
- **Negotiation** (`npm run negotiation`) — a bilateral price-negotiation microbenchmark (model vs model, hidden reservation values, ZOPA / surplus-capture / correct-walkaway metrics). A pure-reasoning baseline, no tools. Adapted from the PACT / AgenticPay protocol.

## Benchmark *your* agent

CloseBench ships a reference agent so it runs out of the box, but the point is to grade **any** agent. Point it at yours with one environment variable:

```bash
SUT_CMD="node /path/to/your/agent.ts" npm run bench
```

Your agent implements a small, documented contract (a signed webhook in, tool side-effects out). See **[docs/ADAPTERS.md](docs/ADAPTERS.md)**.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, the adapter seam, data flow, isolation |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Why it's built this way — scenario design, buyer sim, judge, scoring, calibration, contamination control |
| [docs/RESEARCH.md](docs/RESEARCH.md) | The cited survey of referent benchmarks (τ-bench, SWE-bench, HELM, MLPerf, …) the design is grounded in |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | The agent-under-test contract; how to plug in your agent |
| [docs/SCENARIOS.md](docs/SCENARIOS.md) | The 46-scenario taxonomy, schema, and how to add more |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The stages from working harness to *the* referent |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | Leaderboard submission, verification, neutrality |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute scenarios and adapters |

## Status

**v0.1 harness · dataset v1.0 (frozen).** The harness runs green end-to-end and the scenario set is versioned, digested, and tiered. Still open before the number is fully trustworthy: the **judge–human agreement report** (tooling shipped, labeling pending) and `CloseBench-Verified`. See the [ROADMAP](docs/ROADMAP.md). Extracted from the [CloseForge](https://github.com/AndreuwMetal/closeforge) sales-agent project, from which the scenarios and rubric were battle-tested.

## License

[MIT](LICENSE) © 2026 AndreuwMetal. Scenarios, rubric, harness — all open. Fork it, run it, submit to it.
