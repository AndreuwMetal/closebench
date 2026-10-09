# CloseBench paper (arXiv draft)

Build: `pdflatex closebench && bibtex closebench && pdflatex closebench && pdflatex closebench` (needs a TeX Live with natbib/booktabs/hyperref/xcolor). Every number in `closebench.tex` has a `% source: <file>` comment; red `[TODO: …]` marks what is missing.

Before submission:
- [ ] Table 6 (seeded baselines, k=8): pass^1, pass^8, violations, $/conv for reference-GLM, Opus/Sonnet/Haiku 5.5, `bad.md` floor (+ optional rows), from complete runs in `results/published/`; add the verification seed.
- [ ] Re-derive the 2026-08-31 numbers under the severity rule (`graves()`), or state they are pre-severity.
- [ ] κ: human–human on 1717 with Andrés's original *blind* labels; adjudication outcome; second labeler's affiliation.
- [ ] Author email, date, Forge-AI/CloseForge COI wording, AI-assistance disclosure, Figure 1 (pipeline).
- [ ] References marked `note = {verify}` in `references.bib` (2605.08334, 2606.20708, PACT, SWE-bench-Live, 2402.15813, DarkBench, Anthropic persuasion authors).
- [ ] Zenodo DOI; make `CITATION.cff` author match the paper. Then `grep -n TODO closebench.tex` must return nothing.
