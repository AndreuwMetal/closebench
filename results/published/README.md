# Published runs

The evidence behind the numbers quoted in [`README.md`](../../README.md) and
[`docs/ROADMAP.md`](../../docs/ROADMAP.md). Every claim in those documents that came from a paid
run points at a file here, so a reader can check the arithmetic without spending a euro — the
cheapest rung of [REPRODUCE.md](../../REPRODUCE.md).

Each run is a pair: the `.md` report (headline, per-tier and per-category breakdown, the violation
list with its quotes, and the full manifest) and the `.json` (the same, plus every transcript
recorded during inference).

| Run | What it is |
|---|---|
| `closebench-glm-2026-08-31-1717` | **realestate v1.1** (`baa77c130e24`), public split, k=1, 52 conversations. Reference agent: 41/52, 4 violations, 0 technical errors. The run that validated the new red-team scenarios' ground truth against a live judge. |
| `closebench-glm-2026-08-31-1729` | **Discrimination control** for the above: the deliberately bad prompt (`prompts/bad.md`) over `redteam,regateo,objeciones`. 18/29 with 13 violations, against the reference's 23/29 with 3 on the same 29. |
| `closebench-glm-2026-08-31-1939` | **saas v0.1** (`9e186d0cf27f`), reference agent. ⚠️ **Incomplete and non-citable** by the harness's own rule: one conversation died on a transient 120 s turn timeout and never reached the judge. |
| `closebench-glm-2026-08-31-1949` | The re-run of that one scenario (`saas-redteam-inyeccion-01`), clean. Stitched with the above it is 15/20 — a figure that is always reported as stitched, never as a run. |
| `closebench-glm-2026-08-31-1945` | **saas discrimination control**, `bad.md` over the same 20: 14/20 with 10 violations. The gate separates the two prompts; the success rate does not, which is why saas is still Preview. |

## The blind κ sheets

`revision-humana-2026-08-31-1717.md` and `-1729.md` are **blind labeling sheets**: 20 stratified
conversations each, with the objective facts (was a checkout created, for how much, what the final
state was) but **without the judge's verdict**. They are here as an open invitation — the
judge–human agreement number needs labelers who are not the author, and this is the whole task:
read a conversation, replace the `?` in its `VERDICT` line with `si`/`no`, send the file back.

The `-1729` sheet is the one drawn from the bad-prompt control, which is where the violations live;
a sample without them cannot produce a κ on the `violacion` dimension at all.

## What is not here

**Hidden-split runs.** A report carries its transcripts, and a hidden-split transcript is the
scenario. Publishing one would turn generalization into memorization for every future submission,
so those runs stay on maintainer machines and only their aggregate numbers are quoted. The set
itself is committed as a digest in [`scenarios-hidden.sha256`](../../scenarios-hidden.sha256); that
commitment, not a published transcript, is what proves it was sealed before the scores existed.
