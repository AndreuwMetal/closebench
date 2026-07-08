# Research basis

CloseBench's design is grounded in a survey of the benchmarks that became referents in their fields — what mechanism made each credible, and what to copy. This document is the evidence behind [METHODOLOGY.md](METHODOLOGY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [ROADMAP.md](ROADMAP.md). Citations are inline to primary sources (arXiv, official repos, MLCommons).

> Produced by a deep-research pass over 7 areas. A few third-party leaderboard figures flagged as unverified were dropped; `[UNVERIFIED]` marks exact digits that don't change a design conclusion.

## Part A — Established benchmarks: mechanism + what to copy

### τ-bench / τ²-bench (Sierra) — the closest structural template
Each task is a POMDP: JSON databases, API tools, a **Markdown policy document**, and task instances; the agent sees only tools + policy and touches the DB *through tools*. A hidden instruction drives an **LLM user-simulator** ([2406.12045](https://arxiv.org/abs/2406.12045)).
- **pass^k** = *all k* i.i.d. trials succeed (not code's "≥1 of k"). Unbiased estimator **pass^k = E_task[ C(c,k)/C(n,k) ]** over n trials with c successes. gpt-4o's >60% pass^1 on retail collapses to **<25% pass^8** — the reliability gap is the point.
- **Scoring is programmatic:** reward = r_action × r_output ∈ {0,1}; final DB state must equal the unique ground-truth state. They note the gap CloseBench targets: **r=1 is necessary but not sufficient — an agent can reach the goal state while violating policy.** τ² tightens this with status/NL assertions and **action-matching** ([2506.07982](https://arxiv.org/abs/2506.07982)).
- **τ² dual-control + personas (None/Easy/Hard)** materially change scores; the user must be *coached to act*.
- **Copy:** pass^k as headline (n≥8); reward = state × **policy-gate** × output; a persona'd buyer that must take real actions to close.

### SWE-bench family — programmatic grading + the "Verified" credibility play
2,294 real GitHub issue+PR tasks; grading is **execution-based, zero LLM judgment** in an isolated Docker container: **FAIL_TO_PASS** (issue fixed) AND **PASS_TO_PASS** (regression guard) ([2310.06770](https://arxiv.org/abs/2310.06770)).
- **SWE-bench Verified**: the raw set was noisy (OpenAI: 38.3% under-specified, 61.1% unfair tests), so **93 developers × 3 annotators** produced a **500-problem human-validated subset** ([swebench.com/verified](https://www.swebench.com/verified.html)); cleaning roughly **doubled** scores.
- **SWE-bench Live**: 1,319 post-cutoff instances, ~50 new/month; the same agent scores **19.25% Live vs 43.20% Verified** — a ~2.2× overfitting gap ([2505.23419](https://arxiv.org/html/2505.23419v2)).
- **Governance:** submit a PR with predictions + logs + **mandatory trajectories** + report; a "Checked" mark = maintainers **re-run on a random subset**; **pass@1 only** ([swe-bench/experiments](https://github.com/swe-bench/experiments)).
- **Copy:** a "close resolves only if the close happened AND no guardrail tripped" (= objetivo + 0 violaciones); ship a small human-**Verified** subset early; mandatory trajectories + maintainer re-run.

### HELM (Stanford CRFM) — multi-metric + transparency
Evaluates **7 metrics at once — accuracy, calibration, robustness, fairness, bias, toxicity, efficiency** — so trade-offs aren't second-class ([2211.09110](https://arxiv.org/abs/2211.09110)). Scenario = task + domain(what/when/who) + language; a **scenarios × metrics coverage grid** is published with empty cells named. Calibration via **10-bin ECE** (accuracy and calibration can move in *opposite* directions). Every prompt/completion/score is released. Versioned living benchmark.
- **Copy:** a multi-axis scorecard (never close-rate alone) including **calibration-of-promises (ECE)**; publish every transcript + per-scenario score; a taxonomy with a coverage grid that admits what isn't tested.

### WebArena / GAIA / AgentBench / MLPerf
- **WebArena** — 812 tasks in self-hosted Dockerized real apps; success = **programmatic checkers on end-state**, not string match; GPT-4 14.4% vs human 78.2% ([2307.13854](https://arxiv.org/abs/2307.13854)). *Copy: resettable sandbox (Stripe test-mode + mock CRM), score end-state deal facts.*
- **GAIA** — 466 questions, **300 answers held private**; quasi-exact-match auto-grading; 3 difficulty levels ([2311.12983](https://arxiv.org/abs/2311.12983)). *Copy: private held-out split; L1/L2/L3 tiers.*
- **AgentBench** — 8 environments, one composite + per-dimension breakdown ([2308.03688](https://arxiv.org/abs/2308.03688)). *Copy: multiple sales sub-environments (inbound SaaS demo, e-comm upsell, high-ticket consultative, retention/save) with a per-dimension breakdown.*
- **MLPerf / MLCommons** — neutral non-profit; **Closed** (model ≡ reference, apples-to-apples) vs **Open** (any scaffolding) divisions; **Available/Preview/RDI** tags; versioned rounds; **mandatory mutual peer-review** + **spot-audit**; cheating → result removed ([submission rules](https://github.com/mlcommons/policies/blob/master/submission_rules.adoc)). *Copy: the whole governance spine.*

### LLM-as-judge reliability — biases + the credibility bar
- **Position bias:** GPT-4 only **65% self-consistent** under swapping — reorder can flip the winner. **Verbosity:** repetitive-list attack fools some judges 91.3%. **Self-preference:** GPT-4 +10%, Claude +25% ([2306.05685](https://arxiv.org/abs/2306.05685), [2404.13076](https://arxiv.org/abs/2404.13076)).
- **Mitigations:** reference-guided grading (math failure **70%→15%**); position-swap (tie unless consistent); reasoning-before-score; **panel of ≥3 diverse model families (PoLL)** beats one GPT-4 at ~7–8× lower cost ([2404.18796](https://arxiv.org/abs/2404.18796)) — but only if error-decorrelated.
- **The bar:** MT-Bench GPT-4 judge–human agreement **85% ≥ human–human 81%**. The standard is *matching human–human*, reported as **% agreement + Cohen's κ** on a public calibration set.

### Contamination & gaming
- Train-on-test inflates scores (**GSM1k**: up to ~8% drops, [2405.00332](https://arxiv.org/abs/2405.00332)); **rephrasing defeats n-gram decontamination** → use `llm-decontaminator` (semantic) ([2311.04850](https://arxiv.org/abs/2311.04850)).
- **Canary GUID** (BIG-bench honor system) in every file; **private held-out test with server-side grading** (GAIA/Kaggle); **live rolling refresh** keeping ~1/6 hidden (LiveBench, [2406.19314](https://arxiv.org/abs/2406.19314)).
- **Leaderboard Illusion:** private best-of-N variant selection buys ~+50 Arena points ([2504.20879](https://arxiv.org/html/2504.20879)) → cap private variants, publish all. **Platinum benchmarks:** clean label noise so 100% is attainable ([2502.03461](https://arxiv.org/html/2502.03461)). **DOI-versioned** immutable releases; compare only within a version.

### Sales-specific prior art + the whitespace
Programmatic prior art is mostly **negotiation**: CraigslistBargain ([1808.09637](https://arxiv.org/pdf/1808.09637)), AmazonHistoryPrice ([2402.15813](https://arxiv.org/html/2402.15813v2)), NegotiationArena ([2402.05863](https://arxiv.org/abs/2402.05863)), PACT ([github.com/lechmazur/pact](https://github.com/lechmazur/pact)), TERMS-Bench. Persuasion anchors on money outcomes: Persuasion-for-Good; and Anthropic's persuasiveness study whose key warning is that **the Deceptive strategy was the most persuasive overall** ([anthropic.com](https://www.anthropic.com/news/measuring-model-persuasiveness)) — an *ungated* persuasion score actively rewards lying. Sales dialogue proper is thin (SalesBot scores only naturalness). **Buyer-sim is a known-broken instrument:** LLM buyers **push non-buyers toward buying — halving resistance and fabricating no genuine refusals — systematically over-estimating seller effectiveness** ("Simulated Customers Never Walk Away", [2606.20708](https://arxiv.org/pdf/2606.20708); SalesSim <79% persona alignment, [2605.08334](https://arxiv.org/html/2605.08334v1)). DarkBench gives a manipulation taxonomy; Cicero is the honest-persuasion north star.

**Whitespace CloseBench owns** (no existing package combines these): (1) a real programmatic **close** (sandboxed checkout / booked meeting) as ground truth tied to a chat sale; (2) a scored **sales methodology** rubric (SPIN/Voss/BANT); (3) **compliance as a hard gate**; (4) **pass^k for selling**; (5) a **calibrated, walk-away-capable buyer**; (6) **async/WhatsApp** short-message closing; (7) a **standardized adapter**.

## Part B — Punch-list: what CloseBench must have to be the referent

1. **Scenario taxonomy** — structured tuple `(sales_motion, domain, persona, difficulty, channel, language)`; coverage grid; sub-environments; L1/L2/L3 tiers; personas with hidden budget + a **genuine no-deal condition**; author then **human-validate** with expert closers (Verified > large-but-noisy).
2. **Adapter interface** (thinnest prior art — the whitespace) — transport-agnostic; the **harness owns all state** (buyer-sim, tools, sandbox, grading); the agent is a pure function of conversation state (`emit message OR tool_call`; a terminal tool ends the episode). **Closed/Open** conformance levels; reference adapters (Messages-API, MCP/tool-runner, webhook); a standardized runner.
3. **Scoring** — programmatic terminal objective (end-state, not transcript) × **hard compliance gate** (zeros the run) × **pass^k** (n≥8, headline pass^8) + a fuzzy **rubric layer** (reference-guided, swapped, paneled) reported *separately* + **surplus quality** where price is negotiable.
4. **Judge calibration** — public human calibration set; publish judge–human **% + κ ≥ human–human**; panel of ≥3 families incl. non-Anthropic for neutrality; run position/verbosity/authority attacks as regression tests.
5. **Contamination/versioning** — canary GUID; **public dev + private hidden test, server-side grading**; live rolling refresh; DOI-versioned releases + deprecation list; semantic decontamination + Platinum cleaning pre-release.
6. **Reproducibility** — pinned model IDs (agent, buyer, judge panel); sealed seeds; containerized resettable env; full public transcript release; **cost per closed deal** (real + idealized) — note cost is dominated by the long policy prompt (~96% of τ-bench agent cost).
7. **Leaderboard governance** — neutral consortium; Closed/Open divisions; availability tags; versioned rounds; PR submissions with **mandatory trajectories**; mutual peer-review + spot-audit + maintainer re-run "Checked"; cap private variants ≤3 and publish all; non-compliance beyond a threshold → moved to Open or removed.

## Part C — Confidence

High confidence (canonical primary sources) for all τ-bench, SWE-bench(+Verified/Live), HELM, WebArena, GAIA, AgentBench, MLPerf, MT-Bench, BIG-bench, GSM1k, LiveBench, Leaderboard-Illusion, Platinum mechanisms cited above. Some per-model judge-bias digits and 2026 sales-paper stats are directional/`[UNVERIFIED]`. **The whitespace conclusion is a negative claim and is robust:** even if a single recent paper differs, no existing package combines real-payment close + methodology rubric + calibrated walk-away buyer + hard honesty gate + pass^k + standardized adapter. That combination is CloseBench's defensible position.
