# Roadmap — from working harness to *the* referent

CloseBench is a working benchmark today. Becoming the *reference* sales benchmark is a governance and adoption problem as much as an engineering one. These are the stages. Each builds on the last; the order reflects what earns credibility fastest.

---

### Stage 0 — Working harness ✅ (v0.1, done)

- End-to-end pipeline: signed webhook → real agent → tools → guardrails → mock services → judge → report.
- 46 scenarios, 9 categories, bilingual. Canonical offer. Compliance gate. `pass^k`. Cost accounting.
- Bundled reference agent + bad-prompt discrimination control.
- Standalone, zero-dependency, `bench:dry` green. Public repo, MIT.

### Stage 1 — Credible v1.0 dataset 🎯 (next)

*Goal: a number people trust.*

- **Freeze `CloseBench v1.0`** — versioned, immutable scenario set. Scores cite a version.
- **`CloseBench-Verified`** — a human-audited subset with clean, unambiguous ground truth (SWE-bench Verified's playbook). This becomes the headline number.
- **Difficulty tiers (L1/L2/L3)** — ready-to-buy → multi-objection + tool use → hostile/ambiguous/policy-edge, so scores separate an easy close from a hard one (GAIA).
- **Judge–human agreement report** — label the `revision-humana` samples, publish **% agreement + Cohen's κ**, and clear the bar serious LLM-judged benchmarks hold: **judge–human ≥ human–human** (MT-Bench: 85% ≥ 81%). Without this, the judge is just an opinion.
- **Canary GUID** in the dataset so trainers can exclude it.
- Expand red-team coverage — the compliance gate is the whole point, so adversarial scenarios get the most investment.

### Stage 2 — Plug in any agent 🔌

*Goal: not just Node agents; any stack.*

- **Language-agnostic HTTP adapter** — a thin contract (`POST /message → { bubbles, side_effects }`) so agents don't mimic the Kapso/Stripe/SQLite surface; CloseBench keeps the state. Two conformance levels: **Closed** (fixed buyer/policy/tools → pure agent comparison) and **Open** (bring your own scaffolding), scored separately (MLPerf's split). ([ADAPTERS.md](ADAPTERS.md))
- **Standardized runner** — a reproducible harness (the role MLPerf's LoadGen plays) so any result is machine-verifiable and re-runnable by a referee, not just self-reported.
- **Reference adapters** for common stacks: OpenAI Agents SDK, LangChain/LangGraph, a raw HTTP service.
- **Containerized runs** (Docker) for hermetic, one-command reproduction on any machine — SWE-bench's isolation lesson.
- Seed the board with baselines: reference-GLM, Opus-brain, a couple of public frameworks.

### Stage 3 — Public leaderboard & anti-gaming 🏆

*Goal: a board that can't be cheated.*

- **Hosted leaderboard** with per-category breakdowns, violation counts, and cost — not a single scalar. Headline metric is **pass^8** (reliability), never best-of-k.
- **Held-out / hidden split** — public scenarios for iteration, hidden ones for the official score. Generalization, not memorization. Grading on the hidden split is **server-side** (GAIA / Kaggle): submitters get a score, not the answers.
- **Submission + verification** — PRs ship **mandatory trajectories** (generated with inference, not post-hoc) + logs + pinned config; maintainers **re-run on a random subset** for a "Checked" mark (SWE-bench). To kill the *Leaderboard Illusion* (privately testing N variants and publishing only the best buys ~+50 Arena points), **cap private variants and publish every submitted one**. ([GOVERNANCE.md](GOVERNANCE.md))
- **Versioning discipline** — dataset/rubric/judge changes bump the version; cross-version scores are never compared silently.

### Stage 4 — Generality & neutrality 🌐

*Goal: bigger than one offer, bigger than one author.*

- **More domains** beyond real-estate: B2B SaaS, insurance, high-ticket services — proving the method generalizes. Structured as distinct **sales sub-environments** (inbound SaaS demo, e-commerce upsell, high-ticket consultative, retention/save), one composite score with a per-dimension breakdown (AgentBench).
- **More languages**, with native-speaker review of personas and rubric.
- **Latency & cost SLOs** as first-class axes (a closer too slow or too expensive for WhatsApp isn't good).
- **Neutral governance** — move decisions to a small multi-org group with conflict-of-interest rules (the MLPerf/MLCommons model). A benchmark controlled by one vendor never becomes *the* referent. Concretely: **versioned submission rounds** on a fixed calendar with frozen rules, **availability tags** (Available / Preview / RDI), and **mandatory mutual peer-review + spot-audit** (every submitter reviews another; a COI-free auditor replays against sealed seeds).

### Stage 5 — Reference status 📌

*Goal: the answer to "is this sales agent any good?" is a CloseBench score.*

- Third-party audits and independent reproductions.
- Adoption by agent builders as a release gate; citations in papers and product claims.
- Regular dataset refreshes (a "Live" variant) to stay ahead of contamination as models retrain on the web.

---

## How to help move a stage

The fastest contributions right now (Stage 1–2): **new red-team scenarios**, **human labels** on the judge samples, and the **language-agnostic HTTP adapter**. See [CONTRIBUTING.md](../CONTRIBUTING.md).
