# Live — the rolling-refresh variant

**Status: committed design, not live process** — same honesty rule as [GOVERNANCE.md](GOVERNANCE.md)'s Stage-4 layer: this is the design frozen before it's needed, not a mechanism running today.

## The threat

Public scenarios sit in a public repo, which means they eventually sit in a training corpus. A model that memorized the exam doesn't demonstrate it can sell — it demonstrates it can recall. The [canary GUID](../canary.txt) ([METHODOLOGY.md](METHODOLOGY.md#contamination-versioning-and-gaming)) only detects *willing* excluders: a trainer has to choose to grep for it and drop matching documents. It does nothing to a trainer who doesn't check, and nothing at all once a scenario has already been scraped. A frozen, versioned dataset that never moves is a fixed target — the longer a frozen version (currently v1.1) stays public, the more of the model population has plausibly seen it. Live is the structural answer: refresh the exam faster than models retrain on the web, so recall stops being a viable strategy.

## What Live is

A rolling scenario set per domain, versioned `live-YYYY.Q` (e.g. `realestate live-2026.3`) — disjoint from the frozen numbered versions (`1.1`, `0.1`, ...). The two lines serve different jobs and neither substitutes for the other:

- **Frozen versions** stay citable forever. A paper citing `v1.1 (dataset baa77c130e24)` stays checkable indefinitely — nobody wants "the benchmark version I cited no longer exists."
- **Live** answers a different question: "is this agent good *now*," on a set young enough that contamination is implausible.

Live is not a new schema, linter, or digest algorithm. A Live set is a dataset like any other domain-version — same `offer.json` + `scenarios/*.json` shape ([SCENARIOS.md](SCENARIOS.md#scenario-schema)), same structural linting (`lib/dataset.ts`), same 12-hex digest over the scenario files ([DOMAINS.md](DOMAINS.md), [METHODOLOGY.md](METHODOLOGY.md#contamination-versioning-and-gaming)) — the only thing that's new is that its version string encodes a time window instead of a monotonic number, so it can retire content that a frozen version never would.

| | Frozen (`1.0`, `0.1`, ...) | Live (`live-YYYY.Q`) |
|---|---|---|
| Content | Fixed forever once sealed | N scenarios rotate in/out per quarter |
| Purpose | Citable forever, cross-paper comparison | "Is this agent good *now*" |
| Digest | One digest, permanent | One digest per window, permanent for that window |
| Board grouping | `(domain, version, digest, split)` | Same grouping — a live window is just another `version` value |

## Refresh mechanics

Aligned with [GOVERNANCE.md](GOVERNANCE.md#stage-4--rounds-availability-peer-review-multi-org)'s submission-round calendar (quarterly is the working default there, not yet a fixed commitment — the cadence freezes when rounds activate). Each window:

1. **N new scenarios enter.** Authored through the same PR path as any domain addition — linter + review ([DOMAINS.md](DOMAINS.md#how-to-propose-a-domain)) — nothing about Live skips scenario review.
2. **The same N oldest scenarios retire** into a public archive. A retired scenario is training data by assumption the moment it's been live for a quarter; it stays useful for iteration and regression-testing an agent's history, but it never re-enters a live window.
3. **Ground truth is validated by a live-judge run before the set is sealed.** This names the Stage-1 / Stage-4 lesson explicitly: *linted is not validated*. A Preview domain's ground truth is unproven until a live judge scores it and the discrimination control (reference prompt clearly beats `bad.md`) re-runs on the new window ([DOMAINS.md](DOMAINS.md#lifecycle)). A Live window seals only after that gate, not after the linter alone.

## What keeps it honest

- **Digest committed at seal time**, the same commitment-file pattern as the hidden split's `hidden:seal` ([SUBMISSIONS.md](SUBMISSIONS.md#the-hidden-split)): the digest is written down before submissions arrive against that window, so nobody can tune the window after seeing entries.
- **Scores cite `live-YYYY.Q` + digest** — a Live score without both is exactly as uncitable as a frozen score without version + digest ([SCENARIOS.md](SCENARIOS.md#versioning-and-the-dataset-digest)).
- **Cross-window comparisons are as forbidden as cross-version ones.** This carries over for free: the board already groups by `(domain, dataset version, digest, split)` ([SUBMISSIONS.md](SUBMISSIONS.md#the-leaderboard)) and never renders two versions in one table — a `live-2026.3` row and a `live-2026.4` row are mechanically as separate as `v1.0` and `v1.1` would be. No new board logic is needed, only new version strings flowing through logic that already exists.

## Relationship to the hidden split

Live refreshes the **public** face of a domain — the set anyone can read and iterate against. The hidden split ([SUBMISSIONS.md](SUBMISSIONS.md#the-hidden-split)) is orthogonal: it's the held-out set an official score runs against, and it has its own slower refresh, triggered by a leak or a round boundary, not by a calendar quarter. Don't conflate the two: a domain can refresh its Live public window every quarter while its hidden split stays sealed for a year, and a hidden-split leak forces a hidden refresh without requiring an off-cycle Live refresh at all.

## Costs and limits, stated plainly

Authoring and validating N scenarios a quarter is maintainer time (writing, reviewing, PR'ing scenarios that clear the same bar as any domain addition — [DOMAINS.md](DOMAINS.md#how-to-propose-a-domain)) plus judge/buyer API credit for the pre-seal live-judge validation run. Neither exists yet at the volume Live needs. Until both do, Live is design, not process — the same honest status GOVERNANCE.md gives rounds and peer review.

There is no fake cadence promise here — no "Live launches Q1 2027." The trigger to activate is stated as a condition, not a date: **the first verified board entries** (so there's a baseline worth protecting from contamination) **plus the API credit to run authoring and validation every quarter**. Until both are true, this document states the target, not the current mechanism.

## See also

- [GOVERNANCE.md](GOVERNANCE.md) — versioning discipline, the Stage-4 committed-design layer this document follows the same honesty convention as.
- [DOMAINS.md](DOMAINS.md) — per-domain version/digest lifecycle (Preview → Validated → Official) that a Live window composes with.
- [METHODOLOGY.md](METHODOLOGY.md) — the contamination section and the canary GUID that Live is the structural answer to.
- [ROADMAP.md](ROADMAP.md) — Stage 5, where Live is listed as a reference-status goal.
