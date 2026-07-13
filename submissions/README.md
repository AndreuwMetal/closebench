# Submissions

A submission is the unmodified report JSON a run emits (`results/closebench-*.json`), copied here as `<entrant-name>.json` — the filename is the board name. Full rules and tooling: [docs/SUBMISSIONS.md](../docs/SUBMISSIONS.md).

```
npm run submit:validate submissions/<name>.json   # must pass before you PR
npm run leaderboard                               # regenerate LEADERBOARD.md
```

`<name>.checked.json` files are verification stamps written by maintainers (`npm run verify:submission`) — **a PR that adds or edits one is rejected on sight**; only maintainers write stamps, after re-running you. The sha binding catches reports edited *after* verification (✓ → `⚠ stale`); it does not authenticate origin — that's the PR rule's job. Every submitted variant is published (cap: 3 per organization per dataset version — see [GOVERNANCE.md](../docs/GOVERNANCE.md)).
