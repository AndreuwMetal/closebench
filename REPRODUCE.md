# Reproducing CloseBench

An auditor's ladder: each rung costs more than the last and proves more than the last. Every step is a runnable command. Every trust claim below names its mechanism or states its limit — that's the repo's convention ([MEMORY.md](MEMORY.md)), and this doc holds itself to it.

## 1. Free, 5 minutes — prove the harness is honest

Zero API keys, zero cost.

```bash
docker build -t closebench . && docker run --rm closebench   # hermetic, no local Node/Python needed
# or, on your own machine:
npm run bench:dry:all      # webhook · http · python entrant — plumbing end to end
npm run test:stage3        # the whole anti-gaming machinery: validate accepts honest reports,
                            # rejects doped ones, verify reproduces a dry run, the board sanitizes
npm run negotiation:dry    # the secondary negotiation track, dry
```

This proves the pipeline runs and the anti-gaming checks actually reject bad input — not that any agent is good. `npm run bench:dry:all` running both protocols on identical scenarios is itself a claim: if webhook and http ever diverge, a guardrail got duplicated instead of shared, and that's a bug.

Public CI runs exactly this on every commit ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). The [Actions tab](https://github.com/AndreuwMetal/closebench/actions) is the always-current evidence — a green run there is stronger than trusting this doc, because it's someone else's machine, not the author's.

## 2. Free — audit a published claim's paperwork

No keys, but you're now checking a *specific* score, not just the plumbing.

- **Recompute the dataset digest.** `npm run bench:dry` prints the digest it hashed from `scenarios/*.json` + `offer.json` (single source of truth: [`lib/dataset.ts`](lib/dataset.ts)). Compare it to the digest cited by the claim you're auditing — e.g. `CloseBench v1.1 (dataset baa77c130e24)`. Mismatch means the claim isn't describing this checkout.
- **Check a submission's structure.** `npm run submit:validate submissions/<name>.json` — rejects an incomplete manifest, missing/stripped transcripts, a technical error dressed as a pass, a digest mismatch, or partial split coverage. See [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md) for the full rejection list.
- **Check a `✓ Checked` stamp's binding.** `submissions/<name>.checked.json` embeds the sha256 of the exact report bytes it verified — `sha256sum submissions/<name>.json` and compare. A mismatch means the report was edited after verification (the board would already show `⚠ stale`).
- **Read the runs the docs cite.** Every paid number quoted in [README.md](README.md) and [docs/ROADMAP.md](docs/ROADMAP.md) has its report committed under [`results/published/`](results/published/) — headline, per-tier breakdown, every violation with the quote that triggered it, the full manifest, and the transcripts in the `.json`. You can check that the arithmetic in a claim matches the run it came from without spending anything. **Public split only:** hidden-split reports carry their transcripts, and a hidden transcript *is* the scenario, so those runs are quoted in aggregate and never published — [`results/published/README.md`](results/published/README.md) says which and why.
- **Regenerate the board and diff.** `npm run leaderboard` rebuilds [`LEADERBOARD.md`](LEADERBOARD.md) from `submissions/` and nothing else — it's a view, not a database anyone hand-edits. After regenerating, `git diff LEADERBOARD.md` should touch **only** the `_Last regenerated: …_` timestamp line; any other change means the committed board didn't match the submissions it claims to render.

**Stated limit, verbatim from [docs/GOVERNANCE.md](docs/GOVERNANCE.md):** "Verification stamps are sha-bound to the exact report bytes... The binding does **not** authenticate the stamp's *origin* — there is no maintainer secret, deliberately (no key to leak, anyone can regenerate the board). Origin is guarded by process: only maintainers write `.checked.json` files; a PR that adds or edits one is rejected on sight."

## 3. Paid — reproduce a score

Requires API keys (`.env`) and costs real money, since the buyer, judge, and (usually) the agent's brain are LLM calls.

```bash
npm run verify:submission submissions/<name>.json -- --seed 7
```

This is the same tool maintainers run before granting a ✓. It picks a **seeded** ~20% subset of the submission's scenarios (min 3, seed published with the verdict so the subset is auditable), re-runs *only* those under the manifest's pinned config (split, protocol, prompt, `k`, `SUT_CMD`), and compares per-scenario `pass^k` and violation presence against the claimed report. The bar is **reproduction rate ≥ 80%** — below that, the entry is held and the submitter contacted, never silently dropped.

**Why not token-for-token equality:** the buyer and judge are LLMs with temperature. Two runs under the identical configuration will not produce identical transcripts, and demanding they do would be theater — it would only prove determinism you don't actually have. "Reproduced in configuration" means: same manifest, same split, outcome-level agreement above the bar. The manifest is the contract being checked, not the words exchanged.

## 4. What you cannot reproduce, and why

- **Hidden-split contents.** `scenarios-hidden/` is never published — only its sha256 **commitment** ([`scenarios-hidden.sha256`](scenarios-hidden.sha256): digest + count + seal date) is, proving the set was fixed before submissions arrived without revealing it. You can check a hidden-split claim's digest against the commitment; you cannot see the scenarios themselves.
- **Token-for-token transcripts.** Covered above — buyer and judge temperature makes exact replay meaningless as a bar. What's reproducible is the *outcome*, not the *conversation*.
- **The judge's κ.** Not yet published. The tooling (`npm run kappa`) and the blind sampling (`revision-humana-*.md`) ship and work; a first labeling pass (2026-09-11) exists but is not citable — it was labeled jointly (one labeler) and then adjudicated against the judge, which makes agreement 100% by construction. Two independent blind labelings, the only thing that produces a judge–human agreement number, have not been collected. Until that number exists and clears judge–human ≥ human–human, the judge is a careful opinion, not a measure ([README.md](README.md), Status table). Tracked in [docs/ROADMAP.md — Stage 1](docs/ROADMAP.md#stage-1--credible-v10-dataset--in-progress).

## Citing this benchmark

To cite the *repository*: GitHub's "Cite this repository" button (top of the repo page) reads [`CITATION.cff`](CITATION.cff) automatically.

To cite a *score*: name the mechanism, not just the number. A citable score carries **domain + dataset version + digest + split** — e.g. "CloseBench (realestate, v1.1, dataset `baa77c130e24`, hidden split)". A number without that tuple was never taking the same exam as anyone else's.
