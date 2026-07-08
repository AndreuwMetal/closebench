# MEMORY — CloseBench

> Project memory / context for maintainers and AI assistants. Read this first when picking up work.
> This is the *why* and the *state*; the *how* lives in [docs/](docs/).

## Vision

Become **the reference benchmark for AI sales agents** — the SWE-bench / τ-bench of *selling*. When someone asks "is this agent good at closing deals without lying?", the credible answer should be a CloseBench score.

## Why it exists

Selling is the agentic task that touches money and makes promises, and it had no serious benchmark. Coding has SWE-bench; tool-use / customer-service has τ-bench; general assistants have GAIA/HELM. Sales — funnel advancement, discovery, objection handling, negotiating within policy, and *not* lying under pressure — was unmeasured. CloseBench measures a **whole agent** (prompt + tools + guardrails + state), not a model on a prompt, because that's what actually ships and that's where agents misbehave.

## Key decisions (and why)

- **System-under-test, not model.** The lead reaches the agent through the *production* entry point (an HMAC-signed webhook). We grade the real prompt+tools+guardrails, end to end. [[architecture]]
- **Compliance gate is absolute.** Success = goal reached **AND zero violations**. A brilliant sell that invents a price, guarantees results, ignores an opt-out, or fakes being human is a **fail**. Sales AI that lies is worse than useless.
- **Objective facts anchor the judge.** The scorer reads the truth from mocks + SQLite (was a checkout created, for how much, did a code guardrail fire) and injects it into the judge prompt. The LLM judge scores *style and policy*; the *facts* are not up for debate. Mitigates LLM-judge unreliability.
- **`pass^k`, not single-shot.** Reliability across k runs (τ-bench). A sales agent that closes 1-in-3 tries is not "good sometimes", it's unreliable.
- **Cost is a metric.** \$/conversation from real tokens. A closer at \$2/conv loses to one at \$0.03.
- **Adapter seam = one env var (`SUT_CMD`).** This is what turns a project test suite into a *benchmark*: any agent, any stack, plugs in. The bundled reference agent is just the default entrant.
- **Dry-first.** `npm run bench:dry` validates the entire pipeline with zero keys/cost. It's the CI smoke test and the contributor's first command. Never let it go red.
- **Two tracks.** Main = agentic (tools). Secondary = bilateral negotiation (model vs model, no tools; PACT/AgenticPay). Keep them separate; don't conflate a reasoning baseline with the full exam.
- **Judge = Opus 4.8, Buyer = Sonnet 5 (≠ seller).** Judge and simulated buyer are *different* models from the agent's brain, to avoid self-preference bias.

## Current state (v0.1)

- Harness runs **green end-to-end**, standalone, self-contained. Both tracks pass dry.
- **46 scenarios**, 9 categories, ES 31 / EN 15. Canonical `offer.json` (€5,000 realtor site, 10% discount floor €4,500).
- Zero runtime dependencies. **Node ≥ 24** (native TS, `node:sqlite`).
- Bundled reference agent + bad-prompt control (discrimination check).
- **Not yet:** frozen versioned dataset, human-verified subset, public leaderboard, held-out/hidden set, language-agnostic HTTP adapter. See [docs/ROADMAP.md](docs/ROADMAP.md) — these are the stages to "referent".

## Provenance

Extracted from **[CloseForge](https://github.com/AndreuwMetal/closeforge)** (a WhatsApp sales-agent product), where the scenarios, rubric, and guardrails were battle-tested against a real agent. CloseForge is now *one entrant* that plugs in via `SUT_CMD`. The `git mv` history and the `offer.json` (a real-estate sample) came from there. Nothing proprietary was published — the reference agent is a clean-room minimal implementation of the public contract.

## Conventions

- Inline code comments: **Spanish** (inherited from CloseForge). Docs, README, and commit messages: **English** (public-facing reach).
- No dependencies. If a builtin does it, use the builtin.
- Every non-trivial change keeps `bench:dry` green — that's the runnable check.

## Open questions / next decisions

- Leaderboard hosting + submission verification (self-report vs re-run). → [docs/GOVERNANCE.md](docs/GOVERNANCE.md)
- Held-out set: how much stays public for iteration vs hidden for the official score.
- Judge–human agreement target before v1.0 freeze (the 10% `revision-humana` sample feeds this).
- Second domain beyond real-estate SaaS (B2B SaaS, insurance) to prove generality.
