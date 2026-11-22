---
id: HITLD-839
title: The planner reads the tracker from a checkout the pull-request merge never moves, so a merged item is offered again
kind: work
state: planned
created: 2026-11-22
project: HITLD-15
constraint_of: [HITLD-67 c2]
---


## Why

The HITLD-745 investigation (2026-11-22, PR 517) found the cause of an item being offered again after its pull request merged: `hitld dispatch plan` reads the tracker from the primary checkout, but the pull-request merge only fetches main into origin/main and never moves the checkout, so a merged item still reads `planned`. The reproduction fails without `git merge --ff-only origin/main` and passes with it. Orchestrators work around it by fast-forwarding before every plan.

## Done when

- `hitld dispatch plan` and `hitld merge` read the ready set from the fetched main, or bring the checkout up to it, without the orchestrator having to fast-forward.
- A test reproduces the offer of a merged item first (fails), then passes; the local merge path still works.
- `npm run check`, the offline eval gate and `hitld work check` pass.
