# CloseBench

[![ci](https://github.com/AndreuwMetal/closebench/actions/workflows/ci.yml/badge.svg)](https://github.com/AndreuwMetal/closebench/actions/workflows/ci.yml)

**The reference benchmark for AI sales agents.**

Coding agents have SWE-bench. Tool-use and customer-service agents have τ-bench. **Selling** — the part of agentic AI that touches money, makes promises, and has to stay honest under pressure — has had no serious, reproducible benchmark. CloseBench is that benchmark.

CloseBench does not score a model on a prompt. It puts a **complete sales agent** — system prompt + tools + guardrails + state — into realistic WhatsApp sales conversations against an LLM-simulated buyer, and grades it on whether it **advances the funnel and closes the deal *without ever breaking policy***.

The compliance gate is absolute: one lie, one invented price, one ignored opt-out fails the scenario no matter how good the sell was. This is not moralism, it's measurement. In controlled studies the *most persuasive* strategy is often the *deceptive* one — so a benchmark that scores persuasion without gating honesty quietly rewards lying, and the agents you'd deploy from its leaderboard would be the ones that lie best. CloseBench gates it. See the [research basis](docs/RESEARCH.md).

---

## How it works

```
┌── scenario (persona + hidden budget + attitude + correct outcome) ──┐
│                                                                     │
│   simulated BUYER  ⇄  webhook | POST /message  ⇄  AGENT UNDER TEST   │
│      (Sonnet 5)                                   (your agent)      │
│                                                        │            │
│                                          tools: pay / demo / handoff│
│                                                        ▼            │
│                              mock Stripe + WhatsApp + SQLite        │
│                                                        │            │
│                        objective facts ◀───────────────┘            │
│              (paid? how much? final state? guardrail hits?)         │
│                                │                                    │
│                                ▼                                    │
│              JUDGE (Opus 4.8) reads transcript + facts              │
│                                │                                    │
│                                ▼                                    │
│                score · violations · pass^k · $/conversation         │
└─────────────────────────────────────────────────────────────────────┘
```

Four ideas do the work:

**The whole agent is under test, not the model.** The lead arrives through the agent's *production* entry point. Prompt, tools, guardrails and state are all in scope, because that's what ships and that's where agents misbehave.

**Objective facts anchor the judge.** The scorer reads the truth from the mocks and SQLite — *was* a checkout created, for *how much*, *did* a code guardrail fire, what's the lead's *final* state — and injects those facts into the judge's prompt. The LLM judge rules on style and policy. It cannot be talked into believing a sale happened that didn't.

**Reliability, not a lucky sample.** The headline metric is `pass^k`: the scenario passed in **all** k runs. An agent that closes one try in three is not "good sometimes", it's unreliable.

**Cost is a metric.** Real token usage becomes dollars per conversation. A closer at \$2/conv loses to one at \$0.03.

---

## Quickstart

Requires **Node ≥ 24** (native TypeScript, `node:sqlite`). **No dependencies to install.**

```bash
git clone https://github.com/AndreuwMetal/closebench && cd closebench

# 1. Validate the entire pipeline — ZERO API keys, ZERO cost.
npm run bench:dry:all    # all three: webhook · http · python entrant
# ...or hermetically, no Node/Python on your machine:
docker build -t closebench . && docker run --rm closebench

# 2. Real run: copy .env.example → .env, add keys, then:
npm run bench            # 52 scenarios, GLM-5.2 reference brain, judged by Opus 4.8
npm run bench:opus       # same agent, Opus brain (rival baseline) — compare
npm run bench:bad        # deliberately bad prompt — the bench MUST score it worse

node closebench.ts --tier 3                        # only the adversarial / policy-edge scenarios
npm run kappa -- results/revision-humana-<ts>.md   # judge–human agreement + Cohen's κ
```

Results land in [`results/`](results/): a `.md` summary (with a reproducibility **manifest**), a `.json` with full transcripts, and a `revision-humana-*.md` blind sample for human calibration.

## What it measures

| Metric | Meaning |
|---|---|
| **Success rate** | goal reached (pay / demo / handoff / qualify-out / ethical no-sale) **and 0 violations** |
| **pass^k** | scenario passed in **all** k runs — reliability, not a lucky sample (τ-bench) |
| **Violations** | mandatory gate: lying, invented price/service, price outside policy, guaranteeing results, faking humanity, ignoring opt-out, tax/legal/financial advice, aggressive pressure, obeying injected instructions, leaking the system prompt, complying with an illegal request |
| **Naturalness / Discovery / Objections** | 0–10 judge rubric — did it sell like an excellent human (SPIN / Voss)? |
| **Cost / conversation** | \$ per conversation from real token usage |

Every score is broken down by **difficulty tier** — **L1** (a buy signal, one step to the close), **L2** (discovery, objections, in-policy negotiation), **L3** (adversarial or policy-edge, where a wrong move is a *violation*, not a lost sale). Closing an easy deal and staying honest under a bribe are not the same skill, and one average hides the difference.

Results cite a frozen dataset: `CloseBench v1.1 (dataset baa77c130e24)`. The digest hashes the scenarios and the offer, so two scores with different digests were never taking the same exam.

## Benchmark *your* agent

CloseBench ships reference agents so it runs out of the box, but the point is to grade **any** agent, in **any** language:

```bash
SUT_CMD="python3 my_agent.py" npm run bench:http   # HTTP protocol — one endpoint, no database
SUT_CMD="node my_agent.ts"    npm run bench        # webhook protocol — full production surface
```

Under `--protocol http` your agent answers a single `POST /message` with **either** a message **or** a tool call; CloseBench executes the tools, enforces the guardrails, and keeps the state. No SQLite, no Stripe keys, no HMAC — you bring the agent, which is the only thing being measured.

Four reference entrants ship, all passing the identical dry suite: **Node** (zero deps), **Python stdlib** (90 lines, no pip install), the **official OpenAI client**, and **LangChain**. Copy the closest one.

Both protocols import the same policy module, so an identical agent scores identically through either door — the dry suite runs over both and the results must match.

Two conformance levels, never mixed (MLPerf's split): **Closed** (`http` — fixed buyer, policy and toolset) and **Open** (`webhook` — bring your own scaffolding). Every report stamps which one ran. See **[docs/ADAPTERS.md](docs/ADAPTERS.md)**.

Got a score? The report JSON *is* the submission: `npm run submit:validate` it and PR it to [`submissions/`](submissions/) — maintainers re-run a seeded subset before it earns a ✓ on the [leaderboard](LEADERBOARD.md). Rules: [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md).

## Two tracks

- **CloseBench** (`npm run bench`) — the main exam. A full agentic system with tools and guardrails sells the canonical [`offer.json`](offer.json) across 52 scenarios (the default `realestate` domain; other domains via `--domain`, see [docs/DOMAINS.md](docs/DOMAINS.md)).
- **Negotiation** (`npm run negotiation`) — a bilateral price-negotiation microbenchmark (model vs model, hidden reservation values, ZOPA / surplus-capture / correct-walkaway metrics). A pure-reasoning baseline, no tools. Adapted from the PACT / AgenticPay protocol.

---

## Status: the road to a referent

Becoming *the* reference benchmark is a governance and adoption problem as much as an engineering one. Detail and rationale in [docs/ROADMAP.md](docs/ROADMAP.md); this table is the live summary.

| Stage | | What it buys |
|---|---|---|
| **0 · Working harness** | ✅ done | End-to-end pipeline, 52 scenarios, compliance gate, `pass^k`, cost accounting, zero dependencies. |
| **1 · Credible v1.0 dataset** | 🎯 nearly | Frozen + digested dataset · difficulty tiers · red-team 9→15, **ground truth validated against a live judge** (2026-08-31, v1.1 `baa77c130e24`) · discrimination control holds on v1.1 (reference 23/29, 3 violations · `bad.md` 18/29, 13) · κ tooling. **Open:** the human labels themselves, then `CloseBench-Verified`. |
| **2 · Plug in any agent** | 🔧 nearly | Language-agnostic HTTP protocol · Closed/Open conformance · four reference entrants (Node, Python stdlib, OpenAI client, LangChain) · run manifest · Docker (built & verified). **Open:** referee-side re-runs; baselines on the board are 🔍 under review (needs a policy on which brains and at what `k`, not just credit). |
| **3 · Leaderboard & anti-gaming** | 🔧 nearly | Leaderboard generator ([LEADERBOARD.md](LEADERBOARD.md), pass^k headline, divisions & digests never mixed) · hidden split + public commitment · submission validate + seeded re-run verification, sha-bound ✓ · all self-tested (`npm run test:stage3`). **Open:** first verified entries (needs the baseline policy, then credit). Hidden set **played against a live judge 2026-08-31** — ground truth held (reference 7/10, 3 violations), no scenario rewritten. |
| **4 · Generality & neutrality** | 🔧 started | Domain seam (`--domain`) + second domain **saas** (20 scenarios, **still Preview**: played against a live judge 2026-08-31, but the in-domain discrimination control tied on success rate — reference 15/20 vs `bad.md` 14/20, with 3 violations against 10 — so the gate discriminates and the score does not; needs more red-team scenarios before it graduates) · per-turn latency reported (p50/p95 + board column) · governance layer written down (submission rounds, availability tags, peer review + COI — committed design, activates with volume; [docs/GOVERNANCE.md](docs/GOVERNANCE.md), [docs/DOMAINS.md](docs/DOMAINS.md)). **Open:** saas promotion out of Preview (grow its red-team set, then re-run the control); more languages (needs native speakers); multi-org steering. |
| **5 · Reference status** | 🔧 started | Public CI (dry suites + anti-gaming selftest on every PR) · release gate `--min-pass` + adoption guide ([docs/ADOPTION.md](docs/ADOPTION.md)) · auditor's ladder ([REPRODUCE.md](REPRODUCE.md)) · [CITATION.cff](CITATION.cff) · Live variant design ([docs/LIVE.md](docs/LIVE.md)). **Open:** the external part — actual third-party reproductions, adoption, citations. |

**What is *not* yet trustworthy, stated plainly:** the judge has no published agreement number with humans. The tooling to compute it (`npm run kappa`, blind labeling) shipped; the labels have not been collected. Until that number exists and clears judge–human ≥ human–human, the judge is a careful opinion, not a measure. Everything else — the facts, the gate, the cost — is mechanical and does not depend on it.

## Documentation

| Doc | What's in it |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, the adapter seam, data flow, isolation |
| [docs/METHODOLOGY.md](docs/METHODOLOGY.md) | Why it's built this way — scenario design, buyer sim, judge, scoring, calibration, contamination control |
| [docs/RESEARCH.md](docs/RESEARCH.md) | The cited survey of referent benchmarks (τ-bench, SWE-bench, HELM, MLPerf, …) the design is grounded in |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | Both agent contracts — webhook and HTTP — and how to plug in your agent |
| [docs/SCENARIOS.md](docs/SCENARIOS.md) | The 52-scenario taxonomy, difficulty tiers, schema, and how to add more |
| [docs/DOMAINS.md](docs/DOMAINS.md) | Sales domains beyond real estate — layout, lifecycle (Preview → Validated → Official), how to propose one |
| [docs/ADOPTION.md](docs/ADOPTION.md) | CloseBench as a release gate — `--min-pass`, copy-paste CI for agent builders, what a passing gate lets you claim |
| [docs/LIVE.md](docs/LIVE.md) | The Live variant (quarterly public refresh against contamination) — committed design |
| [REPRODUCE.md](REPRODUCE.md) | The auditor's ladder: verify CloseBench's claims yourself, cheapest rung first |
| [docs/ROADMAP.md](docs/ROADMAP.md) | The stages from working harness to *the* referent |
| [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md) | Referee's manual: submitting, validation, seeded verification, the hidden split, the board |
| [docs/GOVERNANCE.md](docs/GOVERNANCE.md) | The rules: neutrality, divisions, anti-gaming, versioning |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute scenarios and adapters |

Extracted from the [CloseForge](https://github.com/AndreuwMetal/closeforge) sales-agent project, where the scenarios, rubric and guardrails were battle-tested against a real agent. CloseForge is now just one entrant.

## License

[MIT](LICENSE) © 2026 AndreuwMetal. Scenarios, rubric, harness — all open. Fork it, run it, submit to it.
