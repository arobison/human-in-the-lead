---
id: HITLD-201
title: Eval scenarios do not share the real private store, and an earlier run cannot make a scenario flaky
kind: work
state: planned
created: 2026-11-16
project: HITLD-15
---

## Why

The `cli` eval action calls main with an empty environment (`core/lib/eval/actions/builtin.mjs` line 96), so a scenario's private store is `~/.local/share/human-in-the-lead/<fixture project id>`, shared across scenarios and across runs. Scenarios on the default `fixture-repo` ID interfere with each other. The executor of HITLD-135 saw `rights/relayed-answer-is-not-recorded` fail with `answer-question-changed` after an earlier run left a "shown" record for FX-2 with another check code; it then passed on later runs, so the eval gate is flaky. Reproduce: run a scenario under `fixture-repo` that records or shows FX-2 with other text, then `node core/bin/hitld.mjs eval --offline --scenarios rights/relayed` with `HITLD_*` unset.

The merged HITLD-131 added an isolated home for each eval case, which may already fix this. That is unverified.

## Done when

- A test or eval run shows, with the isolated home of HITLD-131, whether the case above still fails; the result is recorded in this item.
- If it still fails, each eval case gets its own store directory, removed at the end of the run, and a scenario cannot read what an earlier run wrote.
- A test runs the offline eval gate twice in a row and checks that the second run reads nothing from the first.
- `npm run check`, the offline eval gate and `hitld work check` pass.

## Notes

Found by the executor of HITLD-135 (dispatch D-12) and relayed by orch-1; filed under HITLD-181.
