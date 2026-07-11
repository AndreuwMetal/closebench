# Governance

A benchmark becomes a *referent* only if its numbers can be trusted by people who don't trust each other — competing vendors, skeptical researchers, buyers making decisions. That requires rules, not just code. This document is the intended governance model; parts of it activate at the [roadmap](ROADMAP.md) stage that needs them.

## Principles

- **Neutrality.** CloseBench must not advantage any model, framework, or vendor — including the agents its authors ship. The bundled reference agent is a *baseline*, never a favored entrant. Long term, decisions move to a small multi-organization group with conflict-of-interest disclosure (the MLCommons / MLPerf model).
- **Open method, comparable numbers.** The harness, scenarios (public split), rubric, and scoring are open. A score is only meaningful with its **benchmark version**; cross-version comparisons are never made silently.
- **Generalization, not memorization.** The official score runs on a **hidden held-out split**. The public split is for iteration and debugging.
- **Reproducible or it doesn't count.** A leaderboard entry must be re-runnable by maintainers, not merely self-reported. Mechanically: unverified entries can appear on public-split (iteration) tables but never wear a ✓, and hidden-split (official) entries don't render at all until a maintainer's seeded re-run reproduces them.

## Submitting a result

The tooling is live — full referee's manual in [SUBMISSIONS.md](SUBMISSIONS.md). In short:

1. A submission **is** the report JSON a run emits (`{ manifiesto, resultados }`): the manifest pins the config (models, protocol, `SUT_CMD`, prompt, dataset version + digest, harness), every result carries its transcript recorded during inference, and cost comes from real tokens. Copy it to `submissions/<entrant-name>.json` and PR it.
2. `npm run submit:validate` must pass — it rejects stripped transcripts, runs with technical errors, digest mismatches, and a declared `k` without its runs.
3. Maintainers run `npm run verify:submission` — a **seeded** (published, auditable) ~20% subset is re-run under the pinned config; per-scenario `pass^k` + violation presence must agree ≥ 80%. Pass → a sha-bound `✓ Checked` stamp. Divergence → the entry is **held and the submitter contacted** (not silently dropped).
4. Official scores run on the **hidden split** by maintainers (`--split hidden`); submitters iterate on the public split.

## Divisions

Borrowed from MLPerf's open/closed split, live since Stage 2 and rendered as separate tables on the board:

- **Closed** (`--protocol http`) — fixed buyer, policy and tool surface, apples-to-apples across agents. The comparable number.
- **Open** (`--protocol webhook`) — bring your own scaffolding (custom tools, retrieval, fine-tunes), to show the frontier. Reported separately, never sorted together.

## Anti-gaming

- **Hidden split** for the official score, with a public **commitment** ([`scenarios-hidden.sha256`](../scenarios-hidden.sha256)): the digest proves the set was fixed before submissions arrived, without revealing a scenario. **Canary GUID** in the public dataset so trainers can exclude it.
- **Versioned, occasionally refreshed** scenarios (a "Live" variant) to stay ahead of web-scale contamination.
- **The compliance gate is not negotiable.** An agent that games close-rate by cutting ethical corners scores *worse*, not better — violations are an automatic scenario fail.
- **The bad-prompt control** stays in CI: if a deliberately bad agent stops scoring worse, the benchmark is broken and the board is frozen until it's fixed.
- **Against the *Leaderboard Illusion*** (privately testing N variants and publishing only the best — worth ~+50 points on Arena): **every submitted variant is published**, superseded entries stay visible, and each organization gets at most **3 entries per dataset version**. Referees cannot count anyone's *private* runs, so this cap is enforced at PR review and stated here so its limits are as public as its intent.
- **Verification stamps are sha-bound** to the exact report bytes: edit a verified report and its ✓ downgrades to `⚠ stale` on the next `npm run leaderboard`. The binding does **not** authenticate the stamp's *origin* — there is no maintainer secret, deliberately (no key to leak, anyone can regenerate the board). Origin is guarded by process: **only maintainers write `.checked.json` files; a PR that adds or edits one is rejected on sight**, and official (hidden-split) rows don't render at all without a valid ✓. Stating the limit beats implying cryptography that isn't there.
- **Submitter-controlled text is sanitized** before it reaches a board cell (filename, model ids): a `|`/backtick payload can't inject fabricated rows into the tables — checked in CI by `npm run test:stage3`.

## Changing the benchmark

- Scenario, rubric, or judge-model changes **bump the version**.
- Rubric/judge changes must show the bad-prompt control still fails clearly, and (where labels exist) report the new judge–human agreement.
- Changes are proposed as PRs and, once the governance group exists, ratified by it.

## Conflicts of interest

Authors and maintainers who also submit agents disclose it. Maintainer-affiliated entries get the same hidden-split re-run as everyone else, publicly noted. The goal is simple: **no one should be able to tell, from the rules, which agent the referees built.**

## Contact

Governance discussion happens in the open on the [issue tracker](https://github.com/AndreuwMetal/closebench/issues). Until the multi-org group is stood up, the repo maintainers are the interim stewards, bound by the principles above.
