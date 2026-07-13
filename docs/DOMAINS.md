# Domains

CloseBench started as one exam: sell one real-estate website offer over WhatsApp. Stage 4 asks whether the method — persona-driven scenarios, a hidden budget, a compliance gate, a judge anchored on objective facts — generalizes past that one offer. A **domain** is how that question gets answered without touching what's already trusted.

## What a domain is

A domain is a self-contained sales exam: one `offer.json` (the fixed thing being sold) plus one scenario set (the personas, attitudes, and expected outcomes that probe it), with its **own version, its own dataset digest, and its own lifecycle** ([Preview → Validated → Official](#lifecycle)). Domains don't share ground truth or a digest — a real-estate score and a SaaS score are answers to different exams, not two rows of the same one.

The root of the repo — `scenarios/` + `offer.json` — **is** the `realestate` domain. Nothing about it moved: it stays frozen at dataset v1.0, same digest, same hidden split, same everything documented in [SCENARIOS.md](SCENARIOS.md). It just now has a name (`realestate`) instead of being implicitly "the dataset."

## Directory layout

```
offer.json                     # realestate domain (root, unchanged — v1.0)
scenarios/*.json                # realestate domain (root, unchanged — v1.0)
scenarios-hidden/                # realestate hidden split (maintainer-only, unchanged)

domains/
  saas/
    offer.json                  # Kanaly: B2B SaaS, WhatsApp inbox + CRM
    scenarios/*.json             # saas domain's public scenario set
```

A new domain is `domains/<name>/offer.json` + `domains/<name>/scenarios/*.json` — same two-file shape the root already used, just namespaced. No new schema: the offer and scenario JSON structures are identical to the ones documented in [SCENARIOS.md](SCENARIOS.md#scenario-schema) and `offer.json`'s own fields.

## Running a domain

```
node closebench.ts --domain saas
npm run bench -- --domain saas
```

`--domain` defaults to `realestate`, so every existing command (`npm run bench:dry`, `npm run bench:opus`, etc.) is unchanged for anyone not opting into a new domain. `lib/dataset.ts` declares each domain's version explicitly (`realestate: "1.0"`, `saas: "0.1"`) — the low version number on `saas` is not a typo, it's the point: a brand-new domain starts unproven, and the version says so.

The run manifest gains `dataset.domain`, alongside the existing `dataset.version` and `dataset.digest` ([SUBMISSIONS.md](SUBMISSIONS.md)). `submit:validate` checks the digest against the **declared domain's** dataset — a `saas`-domain report is validated against `domains/saas/`, not the root.

## Lifecycle

Three stages, each one gate stricter than the last:

1. **Preview** — the domain has an `offer.json` and a scenario set that pass the linter (`lib/dataset.ts`'s structural checks: required fields, unique ids, valid `tier`, valid `exito_esperado`). That's it. **Linted and dry-run only** — `npm run bench:dry -- --domain <name>` proves the harness can execute it end to end at zero cost, but no live judge has ever scored a scenario in it, so its ground truth (the `criterios`, the `exito_esperado`, the `notas_juez`) is **unvalidated**. What keeps a Preview domain off the **official** board is structural, not a special rule: official rows are hidden-split runs with a maintainer's ✓, and a Preview domain has no hidden split to run. Its public-split submissions *do* render — in the domain's own iteration table, flagged **⚠️ Preview domain** by the generator — because labeling them beats hiding them: iteration numbers are still signal for whoever builds against the domain, they're just not citable.
2. **Validated** — a live-judge run confirms the ground truth is sane, **and** the discrimination control is re-run inside the domain: the reference prompt must clearly beat `prompts/bad.md` on that domain's own offer and scenarios ([SCENARIOS.md](SCENARIOS.md#the-bad-prompt-control)). A domain that can't discriminate a good agent from a bad one on its own exam isn't measuring anything yet, no matter how well-formed its JSON is.
3. **Official** — the domain earns a **hidden split**, seeded and sealed the same way `realestate`'s was: `npm run hidden:seal -- --domain <name>` writes the public commitment to `domains/<name>/scenarios-hidden.sha256`, while the hidden scenarios themselves live only on maintainer machines (git- and docker-ignored; [SUBMISSIONS.md](SUBMISSIONS.md#the-hidden-split)). Only then does the domain have an official, reproducible score — public-split numbers before this are iteration, same as they are for `realestate` today.

**Current status:** `realestate` is **Official** — it's the only domain with a hidden split. `saas` (Kanaly: WhatsApp inbox + CRM for B2B teams, annual plan billed upfront, list price 3000 EUR, 10% max discount, 20 scenarios) ships at **Preview**: linted, `bench:dry`-clean, never yet played against a live judge. Its numbers are not citable until it clears the Validated gate.

## Boards never mix domains

The leaderboard groups by `(domain, dataset version, digest, split)` ([SUBMISSIONS.md](SUBMISSIONS.md)) — a `realestate` table and a `saas` table are always separate, the same way Closed and Open divisions are always separate tables and never sorted together.

**There is no cross-domain composite score yet, deliberately.** A single number averaging a `realestate` pass rate with a `saas` pass rate would imply the two exams are commensurable — same difficulty, same stakes, same weighting logic — and nobody has established that. A composite is only meaningful once at least two domains have **verified** entries (Validated ground truth, ideally Official hidden-split numbers) to average over; averaging one solid domain with one Preview domain would just launder the Preview domain's unvalidated ground truth into a number that looks official. Until then: per-domain tables, no composite, and this paragraph is why.

## How to propose a domain

A PR adding `domains/<name>/` must contain:

- **`offer.json`** with every key the schema requires (see the root `offer.json` and its `campos_obligatorios_para_vender` list for the required fields — company, service, pricing including a discount ceiling and its conditions, delivery, who it's for / not for, objections, what requires a human handoff).
- **≥ 15 scenarios** — the floor that lets a domain mirror the taxonomy meaningfully (below it, categories like `redteam` or `descalificar` can't have enough coverage to mean anything).
- **Tier and language spread** — not all L1 (a domain that's all easy closes tests nothing) and not monolingual if the domain claims multi-language support.
- **A red-team subset** where honesty is the profitable answer, same design note as the root set ([SCENARIOS.md](SCENARIOS.md)): refuse the bait and the buyer still closes, so the compliance gate isn't a tax on selling in the new domain either.
- **All fictional entities where facts are asserted** — the company being sold, personas, testimonials and customer cases are invented; nothing that could be mistaken for a real company's data (the same rule that produced the clean-room `realestate` offer, see [MEMORY.md](../MEMORY.md#provenance)). Naming a real *platform* as an integration target ("integrates with Shopify") is fine — that's a capability claim about the fictional product, not an assertion about the platform.

A domain PR that clears the linter enters at **Preview**. Moving it to **Validated** and **Official** are separate, later steps (a live judge run and a hidden-split seal respectively) — a domain PR is not expected to arrive pre-validated.

## See also

- [GOVERNANCE.md](GOVERNANCE.md) — versioning discipline, anti-gaming, and the Stage 4 rounds/availability/peer-review layer that a domain's submissions fall under once it's Official.
- [SCENARIOS.md](SCENARIOS.md) — the scenario schema, categories, tiers, and bad-prompt control, all of which apply per-domain.
- [ROADMAP.md](ROADMAP.md) — Stage 4 ("Generality & neutrality") is where domains, latency, and governance rounds are tracked together.
