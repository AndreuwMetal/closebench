# Governance

A benchmark becomes a *referent* only if its numbers can be trusted by people who don't trust each other — competing vendors, skeptical researchers, buyers making decisions. That requires rules, not just code. This document is the intended governance model; parts of it activate at the [roadmap](ROADMAP.md) stage that needs them.

## Principles

- **Neutrality.** CloseBench must not advantage any model, framework, or vendor — including the agents its authors ship. The bundled reference agent is a *baseline*, never a favored entrant. Long term, decisions move to a small multi-organization group with conflict-of-interest disclosure (the MLCommons / MLPerf model).
- **Open method, comparable numbers.** The harness, scenarios (public split), rubric, and scoring are open. A score is only meaningful with its **benchmark version**; cross-version comparisons are never made silently.
- **Generalization, not memorization.** The official score runs on a **hidden held-out split**. The public split is for iteration and debugging.
- **Reproducible or it doesn't count.** A leaderboard entry must be re-runnable by maintainers, not merely self-reported.

## Submitting a result (Stage 3+)

A submission includes:

1. **Agent** — the `SUT_CMD` and everything to run it (or a hosted endpoint), plus the exact models it uses.
2. **Pinned config** — model ids, temperature/seed where applicable, and the CloseBench version.
3. **Full transcripts + reports** — the generated `results/*.json` for the run.
4. **Cost disclosure** — real \$/conversation.

Maintainers **re-run** the submission against the hidden split. A result is listed only if the re-run reproduces the claimed public-split numbers within tolerance. Divergence → the entry is held and the submitter contacted (not silently dropped).

## Divisions (planned)

Borrowed from MLPerf's open/closed split:

- **Closed** — fixed prompt-format and tool surface, apples-to-apples across agents. The comparable number.
- **Open** — anything goes (custom tools, retrieval, fine-tunes), to show the frontier. Reported separately.

## Anti-gaming

- **Hidden split** for the official score; **canary GUID** in the dataset so trainers can exclude it.
- **Versioned, occasionally refreshed** scenarios (a "Live" variant) to stay ahead of web-scale contamination.
- **The compliance gate is not negotiable.** An agent that games close-rate by cutting ethical corners scores *worse*, not better — violations are an automatic scenario fail.
- **The bad-prompt control** stays in CI: if a deliberately bad agent stops scoring worse, the benchmark is broken and the board is frozen until it's fixed.

## Changing the benchmark

- Scenario, rubric, or judge-model changes **bump the version**.
- Rubric/judge changes must show the bad-prompt control still fails clearly, and (where labels exist) report the new judge–human agreement.
- Changes are proposed as PRs and, once the governance group exists, ratified by it.

## Conflicts of interest

Authors and maintainers who also submit agents disclose it. Maintainer-affiliated entries get the same hidden-split re-run as everyone else, publicly noted. The goal is simple: **no one should be able to tell, from the rules, which agent the referees built.**

## Contact

Governance discussion happens in the open on the [issue tracker](https://github.com/AndreuwMetal/closebench/issues). Until the multi-org group is stood up, the repo maintainers are the interim stewards, bound by the principles above.
