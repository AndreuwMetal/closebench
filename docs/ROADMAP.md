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
- **Judge–human agreement report** — label the `revision-humana` samples, publish agreement %, tune the rubric until it clears a stated bar. Without this, the judge is just an opinion.
- **Canary GUID** in the dataset so trainers can exclude it.
- Expand red-team coverage — the compliance gate is the whole point, so adversarial scenarios get the most investment.

### Stage 2 — Plug in any agent 🔌

*Goal: not just Node agents; any stack.*

- **Language-agnostic HTTP adapter** — a thin contract (`POST /message → { bubbles, side_effects }`) so agents don't mimic the Kapso/Stripe/SQLite surface; CloseBench keeps the state. ([ADAPTERS.md](ADAPTERS.md))
- **Reference adapters** for common stacks: OpenAI Agents SDK, LangChain/LangGraph, a raw HTTP service.
- **Containerized runs** (Docker) for hermetic, one-command reproduction on any machine — SWE-bench's isolation lesson.
- Seed the board with baselines: reference-GLM, Opus-brain, a couple of public frameworks.

### Stage 3 — Public leaderboard & anti-gaming 🏆

*Goal: a board that can't be cheated.*

- **Hosted leaderboard** with per-category breakdowns, violation counts, and cost — not a single scalar.
- **Held-out / hidden split** — public scenarios for iteration, hidden ones for the official score. Generalization, not memorization.
- **Submission + verification** — reproducible submissions (pinned models, seeds, transcripts) that maintainers can re-run, not just self-reported numbers. ([GOVERNANCE.md](GOVERNANCE.md))
- **Versioning discipline** — dataset/rubric/judge changes bump the version; cross-version scores are never compared silently.

### Stage 4 — Generality & neutrality 🌐

*Goal: bigger than one offer, bigger than one author.*

- **More domains** beyond real-estate: B2B SaaS, insurance, high-ticket services — proving the method generalizes.
- **More languages**, with native-speaker review of personas and rubric.
- **Latency & cost SLOs** as first-class axes (a closer too slow or too expensive for WhatsApp isn't good).
- **Neutral governance** — move decisions to a small multi-org group with conflict-of-interest rules (the MLPerf/MLCommons model). A benchmark controlled by one vendor never becomes *the* referent.

### Stage 5 — Reference status 📌

*Goal: the answer to "is this sales agent any good?" is a CloseBench score.*

- Third-party audits and independent reproductions.
- Adoption by agent builders as a release gate; citations in papers and product claims.
- Regular dataset refreshes (a "Live" variant) to stay ahead of contamination as models retrain on the web.

---

## How to help move a stage

The fastest contributions right now (Stage 1–2): **new red-team scenarios**, **human labels** on the judge samples, and the **language-agnostic HTTP adapter**. See [CONTRIBUTING.md](../CONTRIBUTING.md).
