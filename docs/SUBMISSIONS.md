# Submissions, verification & the leaderboard

Stage 3 machinery: how a result gets onto the board, and why the board can't be cheated. The rules live in [GOVERNANCE.md](GOVERNANCE.md); this is the referee's manual for the tooling that enforces them.

The design premise: **the submission format already existed.** Every run writes `results/closebench-*.json` = `{ manifiesto, resultados }`, where the manifest pins the full configuration and every result carries its transcript (generated *with* inference — the harness records the conversation as it happens, so post-hoc trajectories are structurally impossible) and its token usage. A submission is that file, unmodified. No new bundle format, nothing to assemble.

## Submitting

1. Run the benchmark (`k ≥ 8` for a headline-eligible score — the board's metric is `pass^8`).
2. Copy the report JSON to `submissions/<entrant-name>.json` — the filename is the board name.
3. `npm run submit:validate submissions/<entrant-name>.json` must pass.
4. Open a PR with exactly that file. Every PR'd variant is published (see anti-gaming below).

## `submit:validate` — what it rejects

Offline, exit-code driven, CI-friendly. A submission fails if:

- **Manifest incomplete** — version, digest, split, `dataset.domain`, k, protocol, conformance, `sut.cmd` + prompt, all three model ids (brain, buyer, judge), harness git + node. A score without its full configuration is a screenshot.
- **Self-declared division** — `conformidad` is derived from the protocol (`http` = Closed, `webhook` = Open) and checked against it; you don't choose your division. `k` must be an integer ≥ 1 (a `k: 0` would switch off the runs-per-scenario check and allow cherry-picking runs inside a covered set).
- **Any transcript missing or empty** — trajectories are mandatory; a report with stripped conversations is unverifiable and gets rejected, not trusted.
- **Any technical error in a run** — a conversation that died before the judge saw it was never graded. "0 violations" on an incomplete run is not a pass (the report itself already says NO CITABLE; validate enforces it).
- **Dataset digest mismatch** — the report's digest must equal the digest recomputed from this checkout (public split) or match the committed commitment (hidden split). You cannot submit a score against a mutated dataset.
- **Partial coverage** — the report must contain every scenario of its split, and no scenario from outside it. Without this, a `--solo calientes` run (5 easy scenarios) would wear a perfect `pass^k` on the board. `--solo` is for debugging; a citable score takes the whole exam.

It also warns (without failing) when `k < 8` (not headline-eligible), when judge model = brain model (self-preference; [MEMORY.md](../MEMORY.md) requires judge ≠ seller), and when the run is **dry** — a dry report validates (useful for testing the flow) but measures the harness, not an agent, so the leaderboard excludes it. It prints the cost disclosure ($/conversation from real tokens).

## `verify:submission` — the maintainer re-run

Self-reported numbers don't go on the board; reproduced numbers do (SWE-bench's "Checked" mark).

```
npm run verify:submission submissions/<name>.json -- --seed 7
```

- Picks a **seeded random ~20% of the submission's scenarios** (min 3). The seed is published with the verdict, so the subset choice is auditable and not cherry-picked by the referee either.
- Re-runs only those scenarios with the manifest's pinned config: same split, protocol, prompt, k, `SUT_CMD`.
- Compares **per-scenario `pass^k` and violation presence** against the claimed report. Buyer and judge are LLMs with temperature — a run reproduces in *configuration*, not token-for-token, so the comparison is at the outcome level and the bar is a **reproduction rate ≥ 80%** on the subset. Below that, the entry is **held and the submitter contacted** (never silently dropped).
- Writes `submissions/<name>.checked.json`: date, seed, subset, per-scenario diff, rate, verdict, and the **sha256 of the report file** — the stamp is bound to those exact bytes, so swapping the report after verification voids the ✓. The binding does **not** authenticate who wrote the stamp (no maintainer secret, deliberately): stamp *origin* is a process rule — only maintainers write `.checked.json`, and a PR touching one is rejected on sight.

Deterministic dry runs must reproduce at 100%; `npm run test:stage3` asserts exactly that end to end (run → validate → tamper → verify), so the verification machinery itself is under test.

## The hidden split

Public scenarios (`scenarios/`) are for iteration and debugging. The **official score runs on a held-out split** (`scenarios-hidden/`) that is never published — generalization, not memorization (GAIA / Kaggle: grading is server-side; submitters get a score, not the answers).

- `--split hidden` runs it; the report stamps `dataset.split` and the hidden digest.
- The repo commits `scenarios-hidden.sha256` — a **commitment** (digest + scenario count + seal date) proving the hidden set was fixed at a point in time without revealing it. When maintainers publish a hidden-split score, anyone can check the digest against the commitment: the set couldn't have been tuned after seeing submissions.
- Re-seal (`npm run hidden:seal`) only on a version bump, with the ROADMAP noting why.
- Maintainers keep the hidden set backed up **outside** any public repo. Leaking it is the one unrecoverable failure; a leak forces a refresh and a version bump.

## The leaderboard

`npm run leaderboard` regenerates [`LEADERBOARD.md`](../LEADERBOARD.md) from `submissions/`. Static and deterministic: the board is a *view* over verified artifacts, not a database anyone edits.

- **Grouped by (domain, dataset version, digest, split)** — scores are only comparable within one (domain, version, digest, split); tables never mix domains, and versions/digests within a domain are never mixed in one table either. See [DOMAINS.md](DOMAINS.md) for what a domain is and why there's no cross-domain composite score yet.
- **Latency p50** appears as a board column when the report carries it — per-turn agent response time (p50/p95), reported by the run and rendered when present.
- **Divisions separated** (MLPerf): Closed (`http` protocol — fixed buyer, policy, toolset; the comparable number) and Open (`webhook` — bring your own scaffolding) are different tables, never sorted together.
- **Headline metric: `pass^k`** (reliability), never best-of-k. Sort: `pass^k` desc, then success rate, then $/conv asc. Columns include violations and cost — a board that hides cost crowns closers nobody can afford to run.
- **✓ Checked** appears only with a valid, sha-bound verification stamp whose verdict is REPRODUCED.
- Hidden-split tables are the official board; public-split tables are explicitly labeled iteration results. **A hidden-split entry doesn't rank at all without its ✓** — on a checkout without `scenarios-hidden/`, validation can only match digest and size against the commitment, so unverified hidden entries are listed as *pending verification*, never ranked. (On a maintainer checkout, scenario ids are matched exactly — fabricated ids are rejected outright.)
- Submitter-controlled text (entrant name, model ids) is sanitized before it reaches a table cell: a `|`/backtick payload can't inject fabricated rows.

## Anti-gaming summary

| Attack | Counter |
|---|---|
| Train on the test set | Hidden split + commitment; canary GUID in the public set; periodic refresh (Stage 5 "Live") |
| Submit fabricated numbers | Mandatory transcripts + maintainer re-run on a seeded subset; ✓ only after reproduction |
| Strip or doctor trajectories | Transcripts are recorded by the harness during inference; validate rejects reports without them; verification re-derives outcomes from scratch |
| Tune the dataset to a submission | Digest stamped on every report; commitment file for the hidden set; any change bumps the version |
| Submit a partial or inflated run | Full-split coverage required (every scenario, none foreign); `k` must be an integer ≥ 1 with exactly `k` runs per scenario — no cherry-picking scenarios *or* runs |
| Forge a ✓ stamp, spoof a division, inject a row | Stamp origin is maintainer-only (PR rule) + sha-bound against later edits; `conformidad` is derived from the protocol, not self-declared; hidden rows don't render without a ✓; submitter text is sanitized before it reaches a table cell |
| *Leaderboard Illusion* (test N variants privately, publish the best) | **Every submitted variant is published**, including superseded ones; max **3 entries per organization per dataset version**; best-of-variants is never the headline (governance rule — referees can't count private runs, so the cap is enforced at PR review and stated publicly) |
| Game close-rate by cutting ethical corners | The compliance gate: violations are automatic scenario fails inside `pass^k`, and the bad-prompt control in CI freezes the board if a deliberately bad agent stops scoring worse |
| Referee bias | Seeded (published) subset selection; maintainer-affiliated entries get the same re-run, publicly noted |
