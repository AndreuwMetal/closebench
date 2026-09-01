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

## Baseline policy

*Decided 2026-09-01. This is the policy that unblocks the first board entries; before it existed, "which brains get a published number" was an open question and no baseline could be authoritative.*

**Seed, then step back.** CloseBench publishes a small set of maintainer-run baselines so the board is legible on day one, and then it is the community's. This is SWE-bench's and τ-bench's shape, not HELM's: the project is not a measurement house and will not try to keep a systematic sweep of every model current. It is also not MLPerf's pure-submission model, which is correct for a consortium and fatal for a board nobody has submitted to yet.

**The seeded baselines.** Five brains behind the *same* bundled reference agent, so the row compares brains and not scaffolding:

| Baseline | Model id (pinned) | Why it's on the board |
|---|---|---|
| reference-GLM | `glm-5.2` (Z.ai direct) | The bundled default and the **anchor** — see below. |
| Opus | `anthropic/claude-opus-4.8` | Frontier ceiling. |
| Kimi | `moonshotai/kimi-k3` | |
| Qwen | `qwen/qwen3.8-max` | |
| GPT-5.6 Sol | `openai/gpt-5.6-sol` | |
| **`bad.md` floor** | `glm-5.2` with `prompts/bad.md` | **Published as a baseline, not hidden as a test fixture.** Without a floor, a reader has no idea whether 79% is good. It is also the discrimination control, so publishing it makes the board self-checking: the day an entrant scores below the deliberately bad prompt, something is wrong with the entrant or with the set. |

Everything but the first runs through OpenRouter (`--brain <slug>`; any OpenRouter slug works, and a slug with no entry in `PRECIOS` warns and reports a cost of 0 instead of inventing one).

**k = 8.** Not a taste call. At n = 52 and p ≈ 0.79 the binomial standard error is ~5.6 points, so a 95% interval is roughly ±11 points: **two agents within about six scenarios of each other are indistinguishable at k = 1.** That is not a hypothetical — the first `saas` control produced 15/20 against 14/20 and the honest reading was "no difference". Every baseline publishes **pass^1 and pass^8**: pass^1 is capability, pass^8 is reliability, and the distance between them is the most informative number a sales agent has.

**Model ids are pinned with a date.** A provider can change what an endpoint serves without changing its name. A model update is a **new entry**, never a silently updated one.

**One anchor, everything else pinned.** `reference-GLM` is the **anchor**: it re-runs on every dataset version bump, so drift between versions is measurable. Every other baseline stays pinned to the `(domain, version, digest, split)` it ran under and is never silently carried forward. Without an anchor, two dataset versions are two boards that cannot be compared; with a full re-run policy, every bump would cost the whole board again.

**Cost, stated so the policy is honest about its own limits.** Evaluation costs about $0.046 per conversation regardless of brain (buyer + judge), and the brain adds its own. At k = 8 over 52 scenarios that is roughly $28 (GLM) to $54 (Opus) per baseline, about **$190 for the five**. A policy that ignored this would quietly become "whatever the maintainer could afford that month".

**Conflict of interest, applied to the first real case.** CloseForge is the maintainer's product and will be an entrant. Per [Conflicts of interest](#conflicts-of-interest), a maintainer-affiliated entry is disclosed on the board and does not appear as verified without an independent re-run. The baselines above are *brains behind the bundled reference agent*, not maintainer products, and are labeled as maintainer-run.

## Stage 4 — rounds, availability, peer review, multi-org

Stage 3 answers "can this number be reproduced?" Stage 4 answers the next question a skeptic asks: "were the rules fixed *before* the numbers came in, and who's checking the referee?" The mechanisms below are graded honestly — some are live today, some are the committed design waiting on submission volume.

### Versioned submission rounds

The intent: a fixed calendar (e.g. quarterly) where a round's rules — dataset version + digest, `k`, judge/buyer models, that round's latency SLO — are **frozen the moment the round opens**. Every entry submitted inside the round is scored under those identical frozen rules; an entry that lands after the round closes waits for the next one rather than being graded against rules chosen after the fact.

**Status: committed design, not live process.** Today, submission is continuous (open a PR whenever `submit:validate` passes) because round volume doesn't exist yet — there's no queue to protect from rule-shopping. Rounds activate once submission frequency justifies the overhead of freezing and re-opening a rule set; until then this section states the target, not the current mechanism, honestly.

### Availability tags

Borrowed from MLPerf: every submission declares one of

- **Available** — anyone can buy or download the exact system under test today (a public API model + a public prompt/config, or an open-weights model).
- **Preview** — will be Available within a stated window (MLPerf uses months); a submission under Preview gets **one round of grace** before it must convert to Available or drop off the headline table.
- **RDI** (research/dev/internal) — not purchasable or downloadable by a third party. Reported for context, **never headline-ranked** — a number nobody else can reproduce by buying the same thing isn't a comparable claim.

**Enforcement: process, not code.** The tag is a field the submitter declares in the PR description; there is no code that can verify a vendor's public availability. It is **checked at PR review** — a reviewer challenging a mislabeled tag is the mechanism, the same way the 3-entries-per-org cap in [Anti-gaming](#anti-gaming) is a review-time check, not a runtime one. Naming this limit beats implying an availability-verification system that doesn't exist.

### Peer review & spot audit

Two independent checks inside a round, so no single submitter's claim goes unexamined by anyone but the maintainer:

- **Mutual peer review.** Every submitter in a round is **assigned** (not self-selected) one other submission to review — reading the manifest, transcripts, and the reasonableness of the claimed config. Assignment, not choice, is the point: letting submitters pick who reviews whom is how friendly pairs launder each other's numbers.
- **Spot audit.** A COI-free auditor replays a seeded subset of a submission against the pinned config — the same mechanism as `verify:submission`'s seeded ~20% re-run (see [SUBMISSIONS.md](SUBMISSIONS.md)), extended to a round-level, independently-assigned auditor rather than "the maintainer."

**Conflict-of-interest rules:**

- You never review or audit your own organization's entry.
- A review or audit assignment that pairs direct competitors can be **challenged once** — the challenge is heard before the round's results are published, not after.
- All disclosures (who reviewed whom, who audited whom, any COI raised) are **listed in the round's summary**, so the assignment graph is public even though the assignment itself wasn't chosen by the parties.

**Status: committed design, not live process** — same caveat as rounds. There's no peer pool to assign until there are enough submitters in a round to assign pairs meaningfully. Until then, every entry gets the Stage 3 maintainer-run `verify:submission`, which is real and live today but is a single referee, not a peer network.

### Multi-org steering

The end state named since Stage 0 ([Principles](#principles)): a small steering group across organizations, with conflict-of-interest disclosure, deciding scenario/rubric/judge changes and round rules — the MLCommons model. CloseBench does not have this yet; it has one author.

Until the group exists, sole-maintainer authority is mitigated the way a single point of trust is mitigated anywhere reproducibility is possible: not by pretending it isn't sole authority, but by making the authority's decisions checkable.

- **Everything regenerable.** The leaderboard is `npm run leaderboard` run over `submissions/` — a view, not a database anyone (including the maintainer) hand-edits. Dataset digests are recomputed from the checked-out files, not asserted.
- **Public seeds.** `verify:submission`'s subset-selection seed is published with the verdict — a maintainer can't quietly pick a lenient subset.
- **Sha-bound stamps.** A `.checked.json` is bound to the exact report bytes it verified ([SUBMISSIONS.md](SUBMISSIONS.md)); a maintainer editing a report after verification voids its own stamp mechanically, not by trusting the maintainer to re-verify.
- **This document, written before disputes exist.** Freezing the anti-gaming rules and the honesty convention ("every mechanism names its enforcement or states its limit") now, while there is nothing at stake, is cheaper credibility than writing rules to fit a dispute after one happens.

None of this is a substitute for the steering group — it's what makes the wait for one auditable instead of just asserted.

## Contact

Governance discussion happens in the open on the [issue tracker](https://github.com/AndreuwMetal/closebench/issues). Until the multi-org group is stood up, the repo maintainers are the interim stewards, bound by the principles above.
