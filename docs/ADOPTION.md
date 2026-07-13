# Adopting CloseBench as a release gate

CloseBench started as an exam you run to get a number. This page is about running it as a **gate**: a command in your CI that decides, mechanically, whether an agent build is allowed to ship.

## Why a release gate

An agent that ships without an exam ships on vibes — a demo conversation that went well, a spot-check nobody wrote down. The gate replaces that with a mechanical bar: **zero policy violations and a reliability threshold you choose**, checked the same way every time, by a process that exits `1` when the bar isn't cleared. It's not a leaderboard entry and it's not a demo — it's a pass/fail check a CI system can act on without a human reading a transcript.

## The one-command gate

```bash
SUT_CMD="<your agent>" node closebench.ts --protocol http --k 8 --min-pass 0.8
```

Exit `0` = ship. Exit `1` = don't — the run failed one of three checks: a technical error occurred (a conversation that died before the judge saw it — the report itself marks such a run NO CITABLE, and the gate refuses to call that a pass), any violation was logged, or the measured `pass^k` fell below the rate you set. All three are checked; the gate only passes when **all** of them clear.

Why each piece is what it is:

- **`--protocol http`** — Closed conformance: buyer, policy, and toolset are fixed by CloseBench, so the only variable left is your agent. That's what makes the number mean something across different agents and different builds of the same agent. See [ADAPTERS.md](ADAPTERS.md) for what your agent has to implement (one endpoint, `POST /message`).
- **`--k 8`** — reliability, not a lucky sample. `pass^k` is the scenario passing in *all* k runs; the board's headline metric is `pass^8` ([SUBMISSIONS.md](SUBMISSIONS.md)), so gating at the same k means your CI number and a leaderboard number are the same kind of claim.
- **`--min-pass <rate>`** — the threshold is yours to pick. CloseBench doesn't bless one, on purpose: how much unreliability a business can tolerate is a product decision (a checkout agent and a lead-qualification bot don't carry the same risk), not something a benchmark can decide on your behalf. What CloseBench guarantees instead is that the number your threshold is compared against is honest in two of three dimensions — zero violations and run completeness are enforced (exit 1, no override). **Stated limit:** scenario *coverage* is not enforced by the gate — `--solo`/`--tier` compose with `--min-pass` because subsetting is legitimate for debugging (the public CI itself gates a dry subset). What the gate does instead is disclose it where it can't be missed: when the run covered less than the full exam, the `GATE` line itself carries `⚠️ SUBCONJUNTO n/total`. A release gate that greps for `GATE APTO` should also refuse `SUBCONJUNTO`; mechanical full-coverage enforcement is the leaderboard submission path's job ([SUBMISSIONS.md](SUBMISSIONS.md) rejects partial reports outright).

The gate works in `--dry` too, at zero cost — useful for testing the gate logic itself before spending real tokens. Public CI (`.github/workflows/ci.yml`) relies on this and asserts the gate both ways on every push: a 4-scenario dry subset with no intentional violation clears `--min-pass 1.0`, and the full 5-scenario dry set — which includes one intentional violation (`dry-guardrail`) — is asserted to fail `--min-pass 0.7` even though its raw scenario success rate (4/5 = 0.8) clears that bar, because a logged violation fails the gate outright regardless of rate. Anyone can see the gate logic is correct — both APTO and NO APTO — before trusting a number it produces on a real agent.

## Cost reality

A live gate run costs real money: buyer and judge are LLM calls, and every report discloses `$/conversation` from real token usage (README, "Cost is a metric") — there's no way to run the actual exam for free.

The free tier of adoption is the dry suite against your own adapter:

```bash
SUT_CMD="<your agent>" npm run bench:dry:http
```

Zero keys, zero cost, and it exercises the real contract — malformed tool calls, a boot that never returns `200` on `/health`, a response that's neither `message` nor `tool_call`. Run this on **every commit**; it catches contract breakage before it costs anything. Save the paid `--min-pass` gate for release candidates: a tag, a manual trigger, a nightly build — not every push.

## A copy-paste CI job

```yaml
# .github/workflows/closebench.yml — in the agent builder's own repo
name: closebench-gate
on:
  push:                      # dry contract check, every commit — free
  workflow_dispatch:         # paid gate, on demand
  release:
    types: [published]       # paid gate, on release

jobs:
  dry-contract-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { path: agent }
      # Pin the benchmark: a gate against a moving benchmark is not a gate.
      # No release tag exists yet — pin a full commit sha (repo's commit list); switch to a tag when one is cut.
      - uses: actions/checkout@v4
        with: { repository: AndreuwMetal/closebench, ref: <full-commit-sha>, path: closebench }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: SUT_CMD="node ../agent/agent.ts" npm run bench:dry:http
        working-directory: closebench

  paid-gate:
    if: github.event_name != 'push'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { path: agent }
      - uses: actions/checkout@v4
        with: { repository: AndreuwMetal/closebench, ref: <full-commit-sha>, path: closebench }
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: SUT_CMD="node ../agent/agent.ts" node closebench.ts --protocol http --k 8 --min-pass 0.8
        working-directory: closebench
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}   # judge + simulated buyer
```

Pin `ref:` on both checkouts to a full commit sha (or a release tag once the repo cuts one — none exists today), never a branch — a moving `main` means today's green run and tomorrow's are different exams. Cite the CloseBench version *and* the dataset digest the run reported (e.g. `CloseBench v1.0, dataset 47bafe8b1009`) in your release notes, next to the pinned `ref:` — that's the citation that lets someone else check exactly which exam your build passed.

## What a passing gate lets you claim

A green gate is a specific, checkable sentence:

> Passes CloseBench `<domain>` v`<version>` (dataset `<digest>`) at `pass^8 ≥ <rate>` with zero violations, Closed conformance.

Every clause in that sentence names a mechanism you can go re-check (see [DOMAINS.md](DOMAINS.md) for `<domain>` and `--domain`) — and the sentence is only honest if the run covered the **whole exam**: a gate over a `--solo`/`--tier` subset prints `⚠️ SUBCONJUNTO` on its `GATE` line precisely so it can't be quoted as this claim by omission. What it does **not** let you claim is a leaderboard entry — a self-run gate is a private CI check, unverified by anyone else. Getting onto the board requires the submission and re-run path in [SUBMISSIONS.md](SUBMISSIONS.md): `submit:validate`, a maintainer re-run on a seeded subset, and a sha-bound ✓. Run the gate to decide whether to ship; submit to the board to make the number citable by others.
