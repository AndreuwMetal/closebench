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
- **Two protocols, one policy.** `webhook` (agent owns tools/state — "Open" conformance) and `http` (agent answers `POST /message` with a message-or-tool_call; CloseBench owns tools, guardrails and state — "Closed"). Both import `lib/policy.ts`: if the guardrails were duplicated, the same agent would score differently by door and the benchmark would lie. The dry suite runs over both and must match.
- **Dry-first.** `npm run bench:dry` validates the entire pipeline with zero keys/cost. It's the CI smoke test and the contributor's first command. Never let it go red.
- **Two tracks.** Main = agentic (tools). Secondary = bilateral negotiation (model vs model, no tools; PACT/AgenticPay). Keep them separate; don't conflate a reasoning baseline with the full exam.
- **Judge = Opus 4.8, Buyer = Sonnet 5 (≠ seller).** Judge and simulated buyer are *different* models from the agent's brain, to avoid self-preference bias.

## Current state (harness v0.1 · dataset v1.0)

- Harness runs **green end-to-end**, standalone, self-contained. Both tracks pass dry.
- **52 scenarios**, 9 categories, ES 35 / EN 17. Canonical `offer.json` (€5,000 realtor site, 10% discount floor €4,500).
- **Dataset frozen at v1.0** with a sha256 **digest** over `scenarios/*` + `offer.json`, stamped on every report. A score without version+digest is not citable.
- **Difficulty tiers** L1/L2/L3 (4 / 26 / 22), reported separately. L3 = "a wrong move is a violation, not a lost sale" (all `redteam` + the discount/invention traps).
- **Red-team = 15** scenarios. Beyond the classic sales baits it now covers the *agentic* attack surface: prompt injection, system-prompt/tool leak, authority spoofing, vulnerable lead, illegal request, competitor defamation. Judge taxonomy extended to match. Design note: in most red-team scenarios **honesty is the profitable answer** (refuse the bait → the buyer pays), so the gate can't be dismissed as a tax on selling.
- `npm run kappa` computes judge–human **% agreement + Cohen's κ** from the *blind* 10% sample. The old template asked "do you agree with the judge?" — that measures deference, not agreement, and makes κ impossible.
- Zero runtime dependencies. **Node ≥ 24** (native TS, `node:sqlite`).
- Bundled reference agent + bad-prompt control (discrimination check).
- **Language-agnostic HTTP adapter shipped** (`--protocol http`, `npm run bench:dry:http`). Four reference entrants pass the identical dry suite: Node, Python stdlib, official `openai` client, LangChain. A Python agent needs one endpoint and no database.
- **Frameworks that own the agent loop can't be Closed-conformant.** OpenAI Agents SDK / LangGraph `ToolNode` execute the tools themselves; then the guardrails differ per entrant and the board compares whoever wrote the laxest `crear_pago`. Adapters bind tool *schemas* and return the `tool_call` upward. If a framework won't yield its loop → `--protocol webhook`, Open conformance, different column.
- **Two defects the framework adapters exposed:** the dry brain returned a malformed OpenAI response (hand-written clients tolerated it, pydantic-backed SDKs rejected it), and the runner's boot budget was 10 s while importing LangChain takes ~12 s — silently excluding the frameworks Stage 2 exists to support. Now 60 s, `SUT_BOOT_TIMEOUT_MS` to override.
- **Not yet:** the human labels themselves (→ κ report → `CloseBench-Verified`), public leaderboard, held-out/hidden set, Docker, reference adapters for OpenAI/LangChain. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Provenance

Extracted from **[CloseForge](https://github.com/AndreuwMetal/closeforge)** (a WhatsApp sales-agent product), where the scenarios, rubric, and guardrails were battle-tested against a real agent. CloseForge is now *one entrant* that plugs in via `SUT_CMD`. The `git mv` history and the `offer.json` (a real-estate sample) came from there. Nothing proprietary was published — the reference agent is a clean-room minimal implementation of the public contract.

## Conventions

- Inline code comments: **Spanish** (inherited from CloseForge). Docs, README, and commit messages: **English** (public-facing reach).
- No dependencies. If a builtin does it, use the builtin.
- Every non-trivial change keeps `npm run bench:dry:all` green (webhook · http · python) — that's the runnable check. The two protocols must produce *identical* dry results; if they diverge, a guardrail got duplicated instead of shared.
- **The README stage table is the public status surface.** When a roadmap item flips state, update `docs/ROADMAP.md` *and* the table in `README.md` in the same commit. A README claiming a stage that isn't done is the fastest way to lose a benchmark's credibility.

## Open questions / next decisions

- Leaderboard hosting + submission verification (self-report vs re-run). → [docs/GOVERNANCE.md](docs/GOVERNANCE.md)
- Held-out set: how much stays public for iteration vs hidden for the official score.
- Who labels the blind `revision-humana` samples, and how many, before publishing the first κ. (The freeze happened; the κ number is what still gates "the judge is a measure, not an opinion".)
- Second domain beyond real-estate SaaS (B2B SaaS, insurance) to prove generality.
