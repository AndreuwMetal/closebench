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

**Severity re-score.** These runs predate the 2026-09-16 severity rule (`docs/METHODOLOGY.md`): every violation
listed in them failed its run. Re-scored offline with today's `graves()` on the same stored violations:

| run | as published | under the severity rule |
|---|---|---|
| `1717` reference, 52 scenarios | 41/52, 4 violations | **42/52, 2 severe** (`redteam-humano-01` turns into a success) |
| control subset of `1717` (29) | 23/29, 3 violations | **24/29, 1 severe** |
| `1729` `bad.md` control (29) | 18/29, 13 violations | **18–19/29, 10 severe** (`regateo-02` is a `no_venta_etica` case whose DB state the report does not store) |
| `1939`+`1949` saas reference | 15/20, 3 violations | 15/20, 3 severe |
| `1945` saas `bad.md` | 14/20, 10 violations | 14/20, 8 severe |

The gate still separates the prompts on both domains (1 vs 10 severe on the realestate control, 3 vs 8 on saas).

## The blind κ sheets

`revision-humana-2026-08-31-1717.md` and `-1729.md` are **blind labeling sheets**: 20 stratified
conversations each, with the objective facts (was a checkout created, for how much, what the final
state was) but **without the judge's verdict**. They are here as an open invitation — the
judge–human agreement number needs labelers who are not the author, and this is the whole task:
read a conversation, replace the `?` in its `VERDICT` line with `si`/`no`, send the file back.

The `-1729` sheet is the one drawn from the bad-prompt control, which is where the violations live;
a sample without them cannot produce a κ on the `violacion` dimension at all.

**First citable κ — 2026-09-22.** Two labelers, labeling apart, one sheet each per run: Helena Gallego and
Andrés Mármol, **who is the author**. Helena's sheets and both `-1729` sheets are fully blind. On `-1717`,
Andrés's sheet also carries **5 labels he corrected after seeing the judge's verdicts** (not blind; disclosed
in the sheet header). Both versions are published: `-andres-marmol-blind.md` is his original blind sheet,
rebuilt by undoing the 5 documented changes (it reproduces the 65% / κ 0.314 the header records), and
`-andres-marmol.md` is the corrected one. **Cite the fully blind numbers.** `npm run kappa -- <both sheets>`
reproduces every row:

| pair | 1717 (reference) éxito | 1717 violación | 1729 (`bad.md` control) éxito | 1729 violación |
|---|---|---|---|---|
| judge ↔ Andrés (blind) | 65% · κ 0.31 | 70% · κ −0.15 | 60% · κ 0.25 | 65% · κ 0.15 |
| judge ↔ Helena | 65% · κ 0.33 | 80% · κ 0.00¹ | 60% · κ 0.25 | 65% · κ 0.15 |
| **Andrés (blind) ↔ Helena** | **90% · κ 0.78** | **90% · κ 0.00¹** | **100% · κ 1.00** | **100% · κ 1.00** |
| *judge ↔ Andrés (corrected, not blind)* | *85% · κ 0.71* | *90% · κ 0.62* | — | — |
| *Andrés (corrected) ↔ Helena* | *80% · κ 0.57* | *90% · κ 0.00¹* | — | — |

¹ Helena marks no violation on 1717, so κ has no variance to work with there; read the raw agreement.

**The bar (judge–human ≥ human–human) is not cleared.** On 1717, with fully blind labels, the judge agrees
with each human 65% of the time while the two humans agree 90% with each other (with the author's corrected
labels it reads 85% / 65%, mean 75%, against 80% — still below). On 1729 the two humans, labeling
apart, agree on all 20 runs and both mark a single violation (`redteam-urgencia-01`) where the judge
cites 8. The disagreement is the judge being stricter than humans on soft violations, not noise.
The older unsuffixed sheets are the invitation template and the non-citable joint pass.

## What is not here

**Hidden-split runs.** A report carries its transcripts, and a hidden-split transcript is the
scenario. Publishing one would turn generalization into memorization for every future submission,
so those runs stay on maintainer machines and only their aggregate numbers are quoted. The set
itself is committed as a digest in [`scenarios-hidden.sha256`](../../scenarios-hidden.sha256); that
commitment, not a published transcript, is what proves it was sealed before the scores existed.
