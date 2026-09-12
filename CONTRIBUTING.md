# Contributing to CloseBench

CloseBench gets better in three ways: **independent human labels** on the judge's samples, **harder, fairer scenarios**, and **more agents plugged in**. All are welcome; the first is the one blocking the most right now.

## Ground rules

- **Keep `bench:dry` green.** It's the CI check and runs with zero keys. If your change breaks it, it's not done.
- **No dependencies.** Node ≥ 24 builtins only (`node:sqlite`, `node:http`, `node:crypto`, native TS). A PR adding a dependency needs a strong reason.
- **Inline code comments in Spanish; docs and commit messages in English** (project convention).
- **Don't touch ground truth to make an agent pass.** Scenario `exito_esperado` and the rubric encode the *correct* behavior, not the *current* behavior.

## Labeling the judge's samples (most needed)

The judge is an LLM. Until its agreement with humans is published, its verdicts are a careful opinion, not a measure. The bar is **judge–human ≥ human–human** (κ > 0.6), and the right-hand side needs people who label independently. No keys and no cost: the runs are already paid for and committed under [`results/published/`](results/published/).

1. Generate your own blind sheets:
   ```bash
   npm run kappa:muestra -- results/published/closebench-glm-2026-08-31-1717.json --quien <your-name>
   npm run kappa:muestra -- results/published/closebench-glm-2026-08-31-1729.json --quien <your-name>
   ```
   Each run always yields the same stratified sample, so your labels pair up with everyone else's. The sheets are in Spanish (the rubric's working language); the conversations are in Spanish or English.
2. **Label alone and blind.** Until you're done, don't open the `closebench-*.json` / `.md` reports (they contain the judge's verdicts) or anyone else's `revision-humana-*` sheet. Labeling together with someone counts as one labeler.
3. Replace each `?` on the `VERDICT` lines with `si` / `no`, using only the rubric, offer and system facts printed on the sheet. Be strict: the standard is an excellent human salesperson.
4. Open a PR with your sheets. Maintainers run `npm run kappa` over every sheet for that run and publish the numbers. Reviewing the judge's reasoning comes after that and never changes your `VERDICT` lines.

## Adding a scenario

A good scenario is **realistic, discriminative, and unambiguous**:

- **Realistic** — a lead a real salesperson would recognize; natural WhatsApp voice in the scenario's language.
- **Discriminative** — an excellent agent passes, a reckless one fails *for a specific reason*. If every agent passes or every agent fails, it teaches nothing.
- **Unambiguous ground truth** — you can state exactly what the correct outcome is and why. Put the buyer's private accept/leave logic in `criterios`, and edge-case guidance for the judge in `notas_juez`.

Steps:
1. Add the object to `scenarios/<category>.json` (schema in [docs/SCENARIOS.md](docs/SCENARIOS.md)). Unique `id`, and a `tier` (1 = easy close, 2 = discovery/objections, 3 = a wrong move is a *violation*).
2. `npm run bench:dry` — the linter validates structure.
3. `node closebench.ts --solo <id>` — a real single-scenario run (needs keys). Read the transcript: does the judge's verdict match your intended ground truth? If not, the scenario is ambiguous — fix it.
4. Red-team scenarios (`redteam/`) are especially valuable: new ways to bait an agent into lying, inventing, or breaking policy.

## Adding an adapter / plugging in an agent

- Read [docs/ADAPTERS.md](docs/ADAPTERS.md) and `adapters/reference-agent.ts` (the worked example). Four reference entrants (Node, Python stdlib, OpenAI client, LangChain) show the HTTP contract from every angle — copy the closest one.
- If you benchmark a public agent/framework and want it on the leaderboard: the report JSON **is** the submission — `npm run submit:validate` it and PR it to `submissions/`. Process and anti-gaming rules: [docs/SUBMISSIONS.md](docs/SUBMISSIONS.md) + [docs/GOVERNANCE.md](docs/GOVERNANCE.md).

## Changing the rubric or judge

The rubric and judge model define the score, so changes are high-stakes:

- Run `npm run bench:bad` before and after — the bad prompt **must** still score clearly worse. A rubric change that lets the bad agent pass is a regression.
- If you have human labels, report judge–human agreement on the `revision-humana-*.md` sample.
- Rubric/judge changes bump the benchmark version (scores across versions aren't comparable).

## PR checklist

- [ ] `npm run bench:dry` passes (both tracks if you touched shared code).
- [ ] `npm run bench:dry:all` is green (webhook, http and python entrants agree).
- [ ] `npm run test:stage3` passes if you touched submission, verification, leaderboard, or dataset-loading code.
- [ ] If a roadmap item changed state, `docs/ROADMAP.md` **and** the stage table in `README.md` were updated together.
- [ ] New scenarios lint and have unambiguous ground truth.
- [ ] No new dependencies.
- [ ] Docs updated if you changed the contract, schema, or scoring.
