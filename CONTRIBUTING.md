# Contributing to CloseBench

CloseBench gets better in two ways: **harder, fairer scenarios** and **more agents plugged in**. Both are welcome.

## Ground rules

- **Keep `bench:dry` green.** It's the CI check and runs with zero keys. If your change breaks it, it's not done.
- **No dependencies.** Node ≥ 24 builtins only (`node:sqlite`, `node:http`, `node:crypto`, native TS). A PR adding a dependency needs a strong reason.
- **Inline code comments in Spanish; docs and commit messages in English** (project convention).
- **Don't touch ground truth to make an agent pass.** Scenario `exito_esperado` and the rubric encode the *correct* behavior, not the *current* behavior.

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

- Read [docs/ADAPTERS.md](docs/ADAPTERS.md) and `adapters/reference-agent.ts` (the worked example).
- The cleanest contribution right now is the **language-agnostic HTTP adapter** (see [ROADMAP](docs/ROADMAP.md) stage 2): a thin shim so agents don't have to mimic the Kapso/Stripe/SQLite surface.
- If you benchmark a public agent/framework and want it on the leaderboard, see [docs/GOVERNANCE.md](docs/GOVERNANCE.md) for the submission + verification process.

## Changing the rubric or judge

The rubric and judge model define the score, so changes are high-stakes:

- Run `npm run bench:bad` before and after — the bad prompt **must** still score clearly worse. A rubric change that lets the bad agent pass is a regression.
- If you have human labels, report judge–human agreement on the `revision-humana-*.md` sample.
- Rubric/judge changes bump the benchmark version (scores across versions aren't comparable).

## PR checklist

- [ ] `npm run bench:dry` passes (both tracks if you touched shared code).
- [ ] New scenarios lint and have unambiguous ground truth.
- [ ] No new dependencies.
- [ ] Docs updated if you changed the contract, schema, or scoring.
